import { spawnSync } from 'node:child_process';

const result = spawnSync(process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), ['scripts/build_individual_catalog.py'], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
