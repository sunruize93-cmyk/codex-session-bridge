#!/usr/bin/env python3
"""OS flock protects the coordinator, including children after supervisor death."""
import fcntl, os, pathlib, subprocess, sys
root, state, node = sys.argv[1:4]
p = pathlib.Path(state)
p.mkdir(mode=0o700, parents=True, exist_ok=True)
if p.is_symlink() or p.stat().st_uid != os.getuid():
    raise SystemExit('unsafe state directory')
os.chmod(p, 0o700)
fd = os.open(p / 'coordinator.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
try:
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    raise SystemExit(73)
os.set_inheritable(fd, True)
os.environ['SESSION_BRIDGE_LOCK_FD'] = str(fd)
proc = subprocess.Popen([node, str(pathlib.Path(root) / 'server/dist/daemon.js')], pass_fds=(fd,))
raise SystemExit(proc.wait())
