"""Explicit screen-only reading. No AX, activation, input events or image files."""
import hashlib, json, time

def fail(code):
    raise RuntimeError(code)

def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()

def select_window(windows, expected_chat):
    # These are application/main-window titles, not evidence of a standalone chat.
    if not isinstance(expected_chat, str) or expected_chat.strip().casefold() in ('微信', 'wechat', 'weixin'):
        fail('SCREEN_TARGET_UNVERIFIED')
    if not windows or windows[0].get('kCGWindowName') != expected_chat or sum(w.get('kCGWindowName') == expected_chat for w in windows) != 1 or windows[0]['kCGWindowBounds']['Width'] < 400 or windows[0]['kCGWindowBounds']['Height'] < 400:
        fail('SCREEN_TARGET_UNVERIFIED')
    if windows[0].get('kCGWindowSharingState') != 1:
        fail('SCREEN_CAPTURE_RESTRICTED')
    return windows[0]

class ScreenDriver:
    def __init__(self, expected_chat=None):
        self.expected_chat = expected_chat
    def context(self):
        import AppKit, Quartz
        apps = AppKit.NSRunningApplication.runningApplicationsWithBundleIdentifier_('com.tencent.xinWeChat')
        if len(apps) != 1:
            fail('APP_NOT_RUNNING')
        app = apps[0]
        front = AppKit.NSWorkspace.sharedWorkspace().frontmostApplication()
        if not front or front.processIdentifier() != app.processIdentifier():
            fail('SCREEN_TARGET_UNVERIFIED')
        if not Quartz.CGPreflightScreenCaptureAccess():
            fail('OS_PERMISSION_REQUIRED')
        windows = [w for w in Quartz.CGWindowListCopyWindowInfo(Quartz.kCGWindowListOptionOnScreenOnly, Quartz.kCGNullWindowID) if w.get('kCGWindowOwnerPID') == app.processIdentifier() and w.get('kCGWindowLayer') == 0 and w['kCGWindowBounds']['Width'] >= 50 and w['kCGWindowBounds']['Height'] >= 50]
        # WindowServer order is front to back. Require the foreground standalone
        # chat's exact title; never guess a chat inside the main contact-list window.
        window = select_window(windows, self.expected_chat)
        connection = f'{app.processIdentifier()}:{app.launchDate()}'
        return {'connection': connection, 'target': f'{connection}:screen:{window["kCGWindowNumber"]}', 'window_id': window['kCGWindowNumber']}

    def wait_result(self, start):
        import Foundation
        result = []
        start(lambda value, error: result.append((value, error)))
        deadline = time.monotonic() + 5
        while not result and time.monotonic() < deadline:
            Foundation.NSRunLoop.currentRunLoop().runUntilDate_(Foundation.NSDate.dateWithTimeIntervalSinceNow_(0.02))
        if not result or result[0][1] is not None or result[0][0] is None:
            fail('SCREEN_CAPTURE_UNAVAILABLE')
        return result[0][0]

    def capture(self, context):
        import ScreenCaptureKit as SC
        content = self.wait_result(lambda done: SC.SCShareableContent.getShareableContentExcludingDesktopWindows_onScreenWindowsOnly_completionHandler_(True, True, done))
        matches = [w for w in content.windows() if w.windowID() == context['window_id']]
        if len(matches) != 1:
            fail('TARGET_CHANGED')
        window = matches[0]
        if not hasattr(SC, 'SCScreenshotConfiguration'):
            fail('SCREEN_CAPTURE_UNAVAILABLE')
        config = SC.SCScreenshotConfiguration.alloc().init()
        config.setWidth_(int(window.frame().size.width * 2))
        config.setHeight_(int(window.frame().size.height * 2))
        config.setShowsCursor_(False)
        config.setFileURL_(None)
        config.setIgnoreShadows_(True)
        config.setIncludeChildWindows_(True)
        capture_filter = SC.SCContentFilter.alloc().initWithDesktopIndependentWindow_(window)
        output = self.wait_result(lambda done: SC.SCScreenshotManager.captureScreenshotWithFilter_configuration_completionHandler_(capture_filter, config, done))
        image = output.sdrImage()
        if image is None:
            fail('SCREEN_CAPTURE_UNAVAILABLE')
        import Quartz
        if not any(bytes(Quartz.CGDataProviderCopyData(Quartz.CGImageGetDataProvider(image)))):
            fail('SCREEN_CAPTURE_EMPTY')
        if self.context() != context:
            fail('TARGET_CHANGED')
        return image

    def recognize(self, image, region):
        import Vision, Quartz
        request = Vision.VNRecognizeTextRequest.alloc().init()
        request.setRecognitionLanguages_(['zh-Hans', 'en-US'])
        request.setRecognitionLevel_(Vision.VNRequestTextRecognitionLevelAccurate)
        request.setUsesLanguageCorrection_(False)
        request.setRegionOfInterest_(Quartz.CGRectMake(*region))
        handler = Vision.VNImageRequestHandler.alloc().initWithCGImage_options_(image, {})
        success, error = handler.performRequests_error_([request], None)
        if not success or error:
            fail('SCREEN_OCR_UNAVAILABLE')
        lines = []
        for observation in request.results() or []:
            candidates = observation.topCandidates_(1)
            if candidates:
                box = observation.boundingBox()
                if box.origin.x >= 0 and box.origin.y >= 0 and box.origin.x + box.size.width <= 1.001 and box.origin.y + box.size.height <= 1.001:
                    lines.append({'text': str(candidates[0].string()), 'confidence': float(candidates[0].confidence()), 'x': box.origin.x, 'y': box.origin.y})
        return lines

def main(p, driver=None):
    # Reject writes before loading frameworks or observing the application.
    if p['action'] not in ('bind', 'inspect', 'find_chat', 'read'):
        fail('SCREEN_MODE_READ_ONLY')
    binding = p.get('binding') or {}
    driver = driver or ScreenDriver(p.get('screen_chat_name') or binding.get('screen_chat_name'))
    context = driver.context()
    if p['action'] != 'bind' and any(context[k] != binding.get(k) for k in ('connection', 'target')):
        fail('TARGET_CHANGED')
    observation = {**context, 'account': None, 'blocker': None, 'evidence': {'source': 'screen_metadata', 'content_verified': False, 'ax_used': False}}
    if p['action'] in ('bind', 'inspect'):
        return observation
    name = binding.get('screen_chat_name')
    if not isinstance(name, str) or not name:
        fail('SCREEN_TARGET_UNVERIFIED')
    chat_ref = digest({'target': context['target'], 'chat': name, 'backend': 'screen-readonly'})
    if p['action'] == 'find_chat' and p.get('name') != name:
        fail('SCREEN_TARGET_UNVERIFIED')
    if p['action'] == 'read' and p.get('chat_ref') != chat_ref:
        fail('TARGET_CHANGED')
    image = driver.capture(context)
    header = driver.recognize(image, (0, 0.87, 1, 0.12))
    matches = [line for line in header if line['text'].strip() == name.strip() and line['confidence'] >= 0.85]
    if len(matches) != 1:
        fail('SCREEN_TARGET_UNVERIFIED')
    # Standalone chat only: exclude title and composer; never capture the main list.
    lines = driver.recognize(image, (0.03, 0.25, 0.94, 0.60))
    combined = ''.join(''.join(line['text'].split()) for line in sorted(lines, key=lambda line: (-line['y'], line['x'])))
    if '重新登录' in combined or '扫码登录' in combined or ('登录' in combined and '我知道了' in combined):
        fail('SCREEN_TARGET_UNVERIFIED')
    if p['action'] == 'find_chat':
        return {'chat_ref': chat_ref, 'name': name, 'partial': True, 'source': 'screen_ocr', 'ax_used': False, 'ui_input_used': False}
    limit = min(max(int(p.get('limit', 3)), 1), 3)
    selected = sorted([line for line in lines if line['confidence'] >= 0.85], key=lambda line: line['y'])[:limit]
    selected.reverse()
    if not selected:
        fail('SCREEN_OCR_UNAVAILABLE')
    return {'chat_ref': chat_ref, 'text_lines': [line['text'][:1000] for line in selected], 'partial': True, 'source': 'screen_ocr', 'message_boundaries_verified': False, 'ax_used': False, 'ui_input_used': False, 'observed_at': time.time()}
