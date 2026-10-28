# Live experiment status

The user approved a 10% loss trigger or 24-hour limit. The immutable experiment baseline was recorded at2026-10-28T06:10:29.672Z: a quote mark of3.664699USDC including native SOL and token-account deposits. It is not the historical original-funding price or a realized cash amount. Entry permission expires2026-10-29T06:10:29.687Z; protective exits remain allowed afterward.

Three real allocations finalized and reconciled against actual transaction metadata and finalized wallet accounts:

| Asset | USDC spent | Asset received | Fee, SOL | Transaction |
|---|---:|---:|---:|---|
| Wormhole WETH |0.65|0.00027626|0.000005030|[Receipt](https://solscan.io/tx/4qVmJR5nBwL5bQvQR4NyvKiTp9hNQS27kmDqHy1DskVkiGC37gVPyVRbJRKwP3PLH4r6LGNzFbfsSv2i4tkCresC)|
| Sunrise HYPE |0.65|0.007982345|0.000005056|[Receipt](https://solscan.io/tx/3dSgvmYp3JDm8UtGDibf1BR5ubj6hQSP1iW67qsD8eGKKHZu72CSjAW3BztQUUyzfNKyJ6jqZg8zPRbF31aCqZfP)|
| OmniBridge ZEC |0.65|0.00049446|0.000055000|[Receipt](https://solscan.io/tx/3aiKZBJuzAmpgdZxt25HQBtDe1Ee3aT7zw5HtcegX7WCuD3hJmWJ4ZE7Da6E63hQMQm7gZxf41rQ7whsYiC5NpKx)|

USDC remaining0.05; native SOL remaining0.010318753. Three new classic token accounts each hold0.001488440SOL deposits; these are separate from the fees. Closing each full token position was tested through a real unsigned simulation, including the exact deposit refund. The native SOL exit was also simulated, retaining its gas reserve. No actual sale has happened yet, so exit settlement and 5–10% profit remain unverified.

The monitor uses current full-position quotes, an estimated exit-fee allowance, and whole-portfolio value to trigger exits at an estimated5% gain,10% loss, or the deadline. A persistent stop blocks all later entries. Per-asset protective exits do not require successful portfolio-wide valuation. Quote values, closed positions, realized sale proceeds and residual SOL value remain distinct.

Operational limits: the local process needs this computer and network to remain available. A10% trigger is not a guarantee of maximum loss. Quote outages, unexpected wallet activity, unknown tokens, stale locks or unreconciled transactions can require investigation. Live crash recovery and actual sale settlement have not yet been exercised. No GitHub push or profit article has been published.
