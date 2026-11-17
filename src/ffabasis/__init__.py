"""FFA basis and hedging study: Capesize 5TC and TD3C.

The package holds every calculation the study makes, as pure functions on
plain data, and the adapters that fetch and parse its public sources. The
browser engine, src/engine.js, mirrors ffabasis.engine and is held to it
within 1e-9 by tools/validate-engine.mjs.
"""

__version__ = "1.0.0"
