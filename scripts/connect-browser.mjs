import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const { fetchDaemonStatus } = await import(
  pathToFileURL(join(root, 'node_modules/@jackwener/opencli/dist/src/browser/daemon-transport.js'))
    .href
);
const status = await fetchDaemonStatus({ timeout: 1000 });
if (status)
  console.log(
    JSON.stringify(
      {
        running: true,
        daemon: status.daemonVersion,
        extension_connected: status.extensionConnected,
        extension_version: status.extensionVersion,
        profiles: status.profiles?.map((p) => ({
          profile: p.contextId,
          connected: p.extensionConnected,
        })),
      },
      null,
      2,
    ),
  );
else
  execFileSync(
    process.execPath,
    [join(root, 'node_modules/@jackwener/opencli/dist/src/main.js'), 'daemon', 'restart'],
    { stdio: 'inherit' },
  );
