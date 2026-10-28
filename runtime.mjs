import os from 'node:os';
import path from 'node:path';

// Direct research scripts retain their original state; the CLI supplies its isolated setup.
export const stateDir = path.resolve(process.env.HELIUS_BOT_HOME ?? path.join(os.homedir(), '.local/share/helius-trading-bot'));
export const OWNER = process.env.HELIUS_BOT_OWNER ?? '5RnEnvCEAnE2HG32ewbJPTaGEjkDXqoZzGGvHxxgV1uE';
