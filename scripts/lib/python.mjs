import { spawnSync } from 'node:child_process';

/** Use the same interpreter for offline builds and local/CI regression checks. */
export function runPython(args) {
  const interpreter = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const result = spawnSync(interpreter, args, { stdio: 'inherit' });
  if (result.error) {
    console.error(`Could not run ${interpreter}. Install Python 3.11+ or set PYTHON to its executable path.`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
