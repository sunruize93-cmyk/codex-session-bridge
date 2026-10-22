"""Synthetic AX contracts, not a live-client acceptance test."""
import sys, types, unittest, tempfile, os
from unittest.mock import patch
from worker import main, digest

class Node:
    def __init__(self, **attrs):
        self.attrs = attrs

class Fixture:
    instances = []
    def __init__(self):
        Fixture.instances.append(self)
        self.clicks = 0
        self.receipts = tempfile.TemporaryDirectory()
        self.account = Node(AXIdentifier='current_account_id', AXValue='account-a')
        self.recipient = Node(AXIdentifier='current_chat_id', AXValue='recipient-a')
        self.heading = Node(AXIdentifier='big_title_line_h_view', AXValue='同名联系人')
        self.editor = Node(AXIdentifier='chat_input', AXRole='AXTextArea', AXValue='')
        self.area = Node(AXRole='AXList', AXTitle='Messages', AXChildren=[])
        self.send = Node(AXRole='AXButton', AXTitle='发送')
        self.row = Node(AXIdentifier='session_item_同名联系人')
        self.window = Node(AXWindowNumber=9, AXChildren=[self.account, self.recipient, self.heading, self.editor, self.area, self.send, self.row])
        self.ax = Node(AXWindows=[self.window], AXFocusedWindow=self.window)
        app = types.SimpleNamespace(processIdentifier=lambda: 42, launchDate=lambda: 'start')
        self.front = app
        self.apps = types.SimpleNamespace(NSRunningApplication=types.SimpleNamespace(runningApplicationsWithBundleIdentifier_=lambda _: [app]), NSWorkspace=types.SimpleNamespace(sharedWorkspace=lambda: types.SimpleNamespace(frontmostApplication=lambda: self.front)))
        def action(el, _):
            self.clicks += 1
            if el is self.send:
                self.editor.attrs['AXValue'] = ''
                text = Node(AXRole='AXStaticText', AXValue='hello')
                self.area.attrs['AXChildren'].append(Node(AXIdentifier='message-new', AXDescription='Outgoing message', AXChildren=[text]))
            return 0
        def set_attr(el, key, value):
            el.attrs[key] = value
            return 0
        self.modules = {'AppKit': self.apps, 'ApplicationServices': types.SimpleNamespace(AXIsProcessTrusted=lambda: True, AXUIElementCreateApplication=lambda _: self.ax, AXUIElementCopyAttributeValue=lambda e,k,_:(0,e.attrs.get(k)), AXUIElementSetAttributeValue=set_attr, AXUIElementPerformAction=action), 'Quartz': types.SimpleNamespace(CGPreflightScreenCaptureAccess=lambda: True)}
        self.binding = {'connection':'42:start','target':'42:start:9','account':digest('account-a')}
        self.ref = digest({'target':'42:start:9','title':'同名联系人','recipient':'recipient-a'})
    def call(self, action, **params):
        with patch.dict(sys.modules, self.modules), patch('platform.system', return_value='Darwin'):
            return main({'operation_id':'op_test','payload_digest':'digest','receipt_path':os.path.join(self.receipts.name,'receipt.json'),'action':action,'binding':self.binding,'chat_ref':self.ref,**params})

class ContractTests(unittest.TestCase):
    def tearDown(self):
        for f in Fixture.instances:
            f.receipts.cleanup()
        Fixture.instances.clear()
    def test_same_title_different_recipient_never_sends(self):
        f=Fixture();f.editor.attrs['AXValue']='hello';f.recipient.attrs['AXValue']='recipient-b'
        with self.assertRaisesRegex(RuntimeError,'TARGET_CHANGED'):
            f.call('dispatch',body='hello')
        self.assertEqual(f.clicks,0)
    def test_focus_loss_never_sends(self):
        f=Fixture();f.editor.attrs['AXValue']='hello';f.front=types.SimpleNamespace(processIdentifier=lambda:99)
        with self.assertRaisesRegex(RuntimeError,'FOCUS_LOST'):
            f.call('dispatch',body='hello')
        self.assertEqual(f.clicks,0)
    def test_missing_stable_account_never_sends(self):
        f=Fixture();f.account.attrs['AXValue']='';f.binding['account']=None;f.editor.attrs['AXValue']='hello'
        with self.assertRaisesRegex(RuntimeError,'ACCOUNT_UNVERIFIED'):
            f.call('dispatch',body='hello')
        self.assertEqual(f.clicks,0)
    def test_duplicate_chat_names_never_selects(self):
        f=Fixture();f.window.attrs['AXChildren'].append(Node(AXIdentifier='session_item_同名联系人'))
        with self.assertRaisesRegex(RuntimeError,'RECIPIENT_AMBIGUOUS'):
            f.call('find_chat',name='同名联系人')
        self.assertEqual(f.clicks,0)
    def test_new_outgoing_id_confirms_but_old_same_text_does_not(self):
        f=Fixture();prepared=f.call('prepare',body='hello')
        before=f.call('reconcile',body='hello',prepared=prepared['checkpoint'])
        self.assertFalse(before['confirmed'])
        sent=f.call('dispatch',body='hello',prepared=prepared['checkpoint'])
        self.assertTrue(sent['confirmed']);self.assertEqual(f.clicks,1)
        os.unlink(os.path.join(f.receipts.name,'receipt.json'))
        same=f.call('reconcile',body='hello',prepared={'before_ids':['message-new']})
        self.assertFalse(same['confirmed'])
    def test_prepared_then_old_message_loaded_is_not_confirmation(self):
        f=Fixture();f.call('prepare',body='hello')
        f.area.attrs['AXChildren'].append(Node(AXIdentifier='unseen-old',AXDescription='Outgoing message',AXChildren=[Node(AXRole='AXStaticText',AXValue='hello')]))
        self.assertFalse(f.call('reconcile',body='hello')['confirmed'])
        self.assertEqual(f.clicks,0)
    def test_ax_missing_is_error_not_empty_success(self):
        f=Fixture();f.area.attrs['AXTitle']='unexpected'
        with self.assertRaisesRegex(RuntimeError,'WECHAT_AX_UNAVAILABLE'):
            f.call('read')

if __name__ == '__main__':
    unittest.main()
