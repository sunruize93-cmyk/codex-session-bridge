#!/usr/bin/env python3
"""有限 AX 接口。stdin/stdout 一次 JSON；不记录原始树或聊天，不使用坐标发送。"""
import hashlib, json, os, platform, sys, time

def fail(code):
    raise RuntimeError(code)

def digest(v):
    return hashlib.sha256(json.dumps(v, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()

def main(p):
    if platform.system() != 'Darwin':
        fail('UNSUPPORTED_PLATFORM')
    import AppKit
    import ApplicationServices as AX
    import Quartz
    def get(el, key):
        err, value = AX.AXUIElementCopyAttributeValue(el, key, None)
        return value if err == 0 else None
    trusted = bool(AX.AXIsProcessTrusted())
    apps = AppKit.NSRunningApplication.runningApplicationsWithBundleIdentifier_('com.tencent.xinWeChat')
    if p['action'] == 'doctor':
        return {'channel': 'wechat_macos', 'os': platform.mac_ver()[0], 'running': bool(apps), 'accessibility': trusted, 'screen_recording': bool(Quartz.CGPreflightScreenCaptureAccess()), 'screenshot_used': False, 'worker': sys.version.split()[0], 'worker_executable': sys.executable}
    if not trusted:
        fail('OS_PERMISSION_REQUIRED')
    if len(apps) != 1:
        fail('APP_NOT_RUNNING')
    app = apps[0]
    ax = AX.AXUIElementCreateApplication(app.processIdentifier())
    launch = str(app.launchDate())
    connection = f'{app.processIdentifier()}:{launch}'
    windows = get(ax, 'AXWindows') or []
    if len(windows) != 1:
        fail('WECHAT_AX_UNAVAILABLE')
    window = windows[0]
    window_key = get(window, 'AXWindowNumber')
    if window_key is None:
        # AX 对象哈希由系统对象身份决定，不使用标题猜测窗口身份。
        import CoreFoundation
        window_key = CoreFoundation.CFHash(window)
    target = f'{connection}:{window_key}'
    def walk(root, max_nodes=1800):
        todo = [root]
        seen = set()
        while todo and len(seen) < max_nodes:
            el = todo.pop()
            identity = hash(el)
            if identity in seen:
                continue
            seen.add(identity)
            yield el
            todo.extend(reversed(get(el, 'AXChildren') or []))
        if todo:
            fail('WECHAT_AX_UNAVAILABLE')
    def nodes():
        return list(walk(window))
    def label(e):
        return str(get(e, 'AXValue') or get(e, 'AXTitle') or '')
    def unique(predicate):
        matches = [e for e in nodes() if predicate(e)]
        if len(matches) != 1:
            fail('WECHAT_AX_UNAVAILABLE')
        return matches[0]
    def title():
        return label(unique(lambda e: get(e, 'AXIdentifier') == 'big_title_line_h_view'))
    def account():
        found = [label(e) for e in nodes() if get(e, 'AXIdentifier') in ('current_account_id', 'wechat_account_id')]
        return digest(found[0]) if len(found) == 1 and found[0] else None
    def inspect():
        login = [e for e in nodes() if get(e, 'AXRole') == 'AXButton' and label(e) in ('登录', 'Log In', '扫码登录')]
        return {'connection': connection, 'target': target, 'account': account(), 'blocker': 'AUTH_REQUIRED' if login else None, 'evidence': {'ax_available': True}}
    observed = inspect()
    if p['action'] in ('bind', 'inspect'):
        return observed
    guard = p['binding']
    if observed['connection'] != guard['connection'] or observed['target'] != guard['target']:
        fail('TARGET_CHANGED')
    if observed.get('blocker'):
        fail(observed['blocker'])
    if guard.get('account') and observed.get('account') != guard['account']:
        fail('ACCOUNT_MISMATCH')
    def foreground():
        if time.time() * 1000 > p.get('deadline', float('inf')):
            fail('TIMEOUT_BEFORE_DISPATCH')
        # 不连续抢焦点，用户先选择窗口。进程与窗口焦点都须相同。
        front = AppKit.NSWorkspace.sharedWorkspace().frontmostApplication()
        focused = get(ax, 'AXFocusedWindow')
        if not front or front.processIdentifier() != app.processIdentifier() or focused != window:
            fail('FOCUS_LOST')
    def chat_ref():
        ids = [get(e, 'AXValue') for e in nodes() if get(e, 'AXIdentifier') == 'current_chat_id']
        recipient = ids[0] if len(ids) == 1 else None
        return digest({'target': target, 'title': title(), 'recipient': recipient})
    def assert_chat():
        if chat_ref() != p.get('chat_ref'):
            fail('TARGET_CHANGED')
    def message_area():
        return unique(lambda e: get(e, 'AXRole') == 'AXList' and get(e, 'AXTitle') in ('Messages', '消息'))
    def messages():
        area = message_area()
        result = []
        for row in get(area, 'AXChildren') or []:
            values = [label(e) for e in walk(row, 200) if get(e, 'AXRole') == 'AXStaticText' and label(e)]
            if values:
                result.append({'body': '\n'.join(values)[:12000], 'sender': 'ME' if get(row, 'AXDescription') in ('Outgoing message', '自己发送的消息') else 'UNKNOWN', 'message_id': get(row, 'AXIdentifier')})
        return result[-p.get('limit', 10):]
    if p['action'] == 'find_chat':
        foreground()
        # 可见会话列表优先；不存在时填写 AX 搜索框，绝不按 Enter 选第一项。
        name = p['name']
        candidates = [e for e in nodes() if get(e, 'AXIdentifier') == f'session_item_{name}']
        if not candidates:
            search = unique(lambda e: (get(e, 'AXRole') in ('AXSearchField', 'AXTextField') or (get(e, 'AXRole') == 'AXTextArea' and get(e, 'AXTitle') == 'Search')) and (get(e, 'AXIdentifier') in ('search_field', 'search_input') or get(e, 'AXPlaceholderValue') in ('搜索', 'Search') or get(e, 'AXTitle') == 'Search'))
            if AX.AXUIElementSetAttributeValue(search, 'AXValue', name) != 0:
                fail('WECHAT_AX_UNAVAILABLE')
            for _ in range(6):
                foreground()
                result_lists = [e for e in nodes() if get(e, 'AXIdentifier') == 'search_list']
                candidates = [e for area in result_lists for e in walk(area) if label(e) == name and get(e, 'AXIdentifier') in (f'session_item_{name}', f'contact_item_{name}', f'group_item_{name}')]
                if candidates:
                    break
                time.sleep(0.2)
        if len(candidates) != 1:
            fail('RECIPIENT_AMBIGUOUS' if len(candidates) > 1 else 'UI_CHANGED')
        foreground()
        err = AX.AXUIElementPerformAction(candidates[0], 'AXPress')
        if err != 0:
            fail('WECHAT_AX_UNAVAILABLE')
        for _ in range(6):
            foreground()
            if title() == name:
                return {'chat_ref': chat_ref(), 'name': name, 'partial': True, 'source': 'visible_ax'}
            time.sleep(0.2)
        fail('TARGET_CHANGED')
    assert_chat()
    if p['action'] == 'read':
        return {'chat_ref': p['chat_ref'], 'messages': messages(), 'partial': True, 'source': 'visible_ax', 'observed_at': time.time()}
    def read_receipt():
        path = p.get('receipt_path')
        if not path or not os.path.exists(path):
            return None
        with open(path, encoding='utf-8') as f:
            r = json.load(f)
        if r.get('operation_id') != p.get('operation_id') or r.get('payload_digest') != p.get('payload_digest') or r.get('target') != target:
            fail('TARGET_CHANGED')
        return r
    if p['action'] == 'reconcile':
        receipt = read_receipt()
        return receipt if receipt and receipt.get('confirmed') else {'confirmed': False, 'reason': '缺少本次点击捕获的可靠回执'}
    editor = unique(lambda e: get(e, 'AXRole') == 'AXTextArea' and get(e, 'AXIdentifier') in ('chat_input', 'message_input', 'input_text_area'))
    if p['action'] == 'prepare':
        foreground()
        if AX.AXUIElementSetAttributeValue(editor, 'AXValue', p['body']) != 0 or label(editor) != p['body']:
            fail('UI_CHANGED')
        return {'target_ref': p['chat_ref'], 'preview': {'chat_ref': p['chat_ref'], 'body': label(editor)}, 'checkpoint': {'before_ids': [m['message_id'] for m in messages() if m.get('message_id')]}}
    if p['action'] == 'dispatch':
        # 同一工作调用内核验账号、接收者、编辑器与前台，使用明确发送按钮。
        foreground()
        assert_chat()
        recipient = [get(e, 'AXValue') for e in nodes() if get(e, 'AXIdentifier') == 'current_chat_id']
        if len(recipient) != 1 or not recipient[0]:
            fail('RECIPIENT_UNVERIFIED')
        if not guard.get('account') or observed.get('account') != guard['account']:
            fail('ACCOUNT_UNVERIFIED')
        if label(editor) != p['body']:
            fail('PAYLOAD_CHANGED')
        send = unique(lambda e: get(e, 'AXRole') == 'AXButton' and label(e) in ('发送', 'Send'))
        foreground()
        assert_chat()
        receipt = read_receipt()
        if receipt:
            return receipt
        path = p.get('receipt_path')
        if not path or not p.get('operation_id') or not p.get('payload_digest'):
            fail('OUTCOME_UNKNOWN')
        before = [m['message_id'] for m in messages() if m.get('message_id')]
        receipt = {'operation_id': p['operation_id'], 'payload_digest': p['payload_digest'], 'target': target, 'confirmed': False}
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(receipt, f); f.flush(); os.fsync(f.fileno())
        foreground(); assert_chat()
        if account() != guard['account'] or label(editor) != p['body']:
            fail('TARGET_CHANGED')
        if AX.AXUIElementPerformAction(send, 'AXPress') != 0:
            fail('OUTCOME_UNKNOWN')
        # 只捕获紧接本次点击的结果；日后加载的旧消息不能变成本次成功。
        matches = [m for m in messages() if m.get('message_id') and m['message_id'] not in before and m['sender'] == 'ME' and m['body'] == p['body']]
        if len(matches) == 1 and label(editor) == '':
            receipt.update({'confirmed': True, 'confirmation': 'ui_only', 'message_id': matches[0]['message_id']})
            temp = path + '.tmp-' + str(os.getpid())
            fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, 'w', encoding='utf-8') as f:
                json.dump(receipt, f); f.flush(); os.fsync(f.fileno())
            os.replace(temp, path)
        return receipt
    fail('UNSUPPORTED_ACTION')

if __name__ == '__main__':
    try:
        data = json.loads(sys.stdin.buffer.read(262145))
        output = {'ok': True, 'data': main(data)}
    except Exception as e:
        known = {'OS_PERMISSION_REQUIRED', 'APP_NOT_RUNNING', 'WECHAT_AX_UNAVAILABLE', 'TARGET_CHANGED', 'ACCOUNT_MISMATCH', 'AUTH_REQUIRED', 'FOCUS_LOST', 'RECIPIENT_AMBIGUOUS', 'UI_CHANGED', 'PAYLOAD_CHANGED', 'ACCOUNT_UNVERIFIED', 'RECIPIENT_UNVERIFIED', 'OUTCOME_UNKNOWN', 'UNSUPPORTED_ACTION', 'UNSUPPORTED_PLATFORM', 'TIMEOUT_BEFORE_DISPATCH'}
        output = {'ok': False, 'error': str(e) if str(e) in known else 'WECHAT_AX_UNAVAILABLE'}
    print(json.dumps(output, ensure_ascii=False))
