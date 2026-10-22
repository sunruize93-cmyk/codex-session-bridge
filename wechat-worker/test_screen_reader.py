"""Screen-only contracts; no real application access."""
import unittest
from screen_reader import main, digest, select_window

class Driver:
    def __init__(self):
        self.captures = 0; self.regions = []
        self.ctx = {'connection':'42:start','target':'42:start:screen:9','window_id':9}
        self.header = [{'text':'文件传输助手','confidence':0.99,'x':0.6,'y':0.94}]
        self.lines = [{'text':f'synthetic-{i}','confidence':0.99,'x':0.7,'y':0.3+i*0.05} for i in range(8)]
    def context(self): return self.ctx
    def capture(self, _): self.captures += 1; return object()
    def recognize(self, _, region):
        self.regions.append(region)
        return self.header if region[1] == 0.87 else self.lines

class ScreenTests(unittest.TestCase):
    def setUp(self):
        self.d = Driver()
        self.b = {**self.d.ctx,'backend':'screen-readonly','screen_chat_name':'文件传输助手'}
        self.ref = digest({'target':self.b['target'],'chat':'文件传输助手','backend':'screen-readonly'})
    def call(self, action='read', **kw):
        return main({'action':action,'binding':self.b,'chat_ref':self.ref,**kw}, self.d)
    def test_metadata_bind_inspect_do_not_capture(self):
        self.call('bind'); self.call('inspect')
        self.assertEqual(self.d.captures,0); self.assertEqual(self.d.regions,[])
    def test_title_required_before_reading_chat(self):
        self.d.header[0]['text']='another chat'
        with self.assertRaisesRegex(RuntimeError,'SCREEN_TARGET_UNVERIFIED'): self.call()
        self.assertEqual(len(self.d.regions),1)
    def test_duplicate_header_rejects(self):
        self.d.header *= 2
        with self.assertRaisesRegex(RuntimeError,'SCREEN_TARGET_UNVERIFIED'): self.call()
    def test_target_change_rejects_before_capture(self):
        self.b['target']='other'
        with self.assertRaisesRegex(RuntimeError,'TARGET_CHANGED'): self.call()
        self.assertEqual(self.d.captures,0)
    def test_only_three_lines_from_same_standalone_chat_capture(self):
        r=self.call(limit=50)
        self.assertEqual(self.d.captures,1)
        self.assertEqual(r['text_lines'],['synthetic-2','synthetic-1','synthetic-0'])
        self.assertFalse(r['message_boundaries_verified']); self.assertFalse(r['ax_used']); self.assertFalse(r['ui_input_used'])
        self.assertEqual(self.d.regions[1],(0.03,0.25,0.94,0.60))
    def test_writes_rejected_without_observing_app(self):
        self.d.context=lambda: self.fail('write observed app')
        for action in ('prepare','dispatch','reconcile'):
            with self.assertRaisesRegex(RuntimeError,'SCREEN_MODE_READ_ONLY'): self.call(action)
    def test_possible_login_content_rejects(self):
        self.d.lines[0]['text']='请重新登录'
        with self.assertRaisesRegex(RuntimeError,'SCREEN_TARGET_UNVERIFIED'): self.call()
    def test_internal_spaces_distinguish_chat_titles(self):
        self.b['screen_chat_name']='Li Na';self.d.header[0]['text']='LiNa'
        with self.assertRaisesRegex(RuntimeError,'SCREEN_TARGET_UNVERIFIED'): self.call('find_chat',name='Li Na')
    def test_split_relogin_prompt_blocks_find_and_read(self):
        self.d.lines=[{'text':text,'confidence':0.99,'x':0.7,'y':0.7-i*0.05} for i,text in enumerate(['为了你的账号安全，请重新','登录','我知道了'])]
        for action in ('read','find_chat'):
            with self.assertRaisesRegex(RuntimeError,'SCREEN_TARGET_UNVERIFIED'): self.call(action,name='文件传输助手')
    def test_restricted_or_unknown_sharing_rejects_before_capture(self):
        window={'kCGWindowName':'文件传输助手','kCGWindowBounds':{'Width':600,'Height':640},'kCGWindowSharingState':1}
        self.assertIs(select_window([window],'文件传输助手'),window)
        for state in (0,None):
            with self.assertRaisesRegex(RuntimeError,'SCREEN_CAPTURE_RESTRICTED'): select_window([{**window,'kCGWindowSharingState':state}],'文件传输助手')
        with self.assertRaisesRegex(RuntimeError,'SCREEN_TARGET_UNVERIFIED'): select_window([{**window,'kCGWindowName':'other'},window],'文件传输助手')
    def test_worker_screen_route_does_not_import_ax(self):
        from unittest.mock import patch
        from worker import main as worker_main
        with patch('platform.system',return_value='Darwin'),patch('screen_reader.ScreenDriver',return_value=self.d),patch.dict('sys.modules',{'ApplicationServices':None}):
            self.assertFalse(worker_main({'action':'read','binding':self.b,'chat_ref':self.ref})['ax_used'])
    def test_main_titles_and_duplicate_chat_windows_rejected(self):
        window={'kCGWindowName':'文件传输助手','kCGWindowBounds':{'Width':600,'Height':640},'kCGWindowSharingState':1}
        for title in ('微信','WeChat','Weixin','wechat'):
            with self.assertRaisesRegex(RuntimeError,'SCREEN_TARGET_UNVERIFIED'): select_window([{**window,'kCGWindowName':title}],title)
        with self.assertRaisesRegex(RuntimeError,'SCREEN_TARGET_UNVERIFIED'): select_window([window,dict(window)],'文件传输助手')

if __name__=='__main__': unittest.main()
