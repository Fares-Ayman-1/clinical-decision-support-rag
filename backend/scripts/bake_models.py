"""Download the embedding and reranker models into the image at build time.

Run once from backend/Dockerfile. Baking the weights in turns an ~80 s cold
download (per .env.example) into a build-time cost, and removes a runtime
dependency on huggingface.co being reachable — which matters on a PaaS, where
the filesystem is ephemeral and every restart would otherwise re-download.

The TLS handling below is only for building on a network that intercepts
HTTPS. On a normal network none of it engages and the download is ordinary
TLS, which is what happens in a cloud build.

Why it is not just truststore.inject_into_ssl():

    inject_into_ssl() patches ssl.SSLContext, but huggingface_hub >= 1.0
    fetches via httpx, and httpx builds its own context that the patch never
    reaches. Verified in a throwaway container against this repo's
    interception CA (which OpenSSL rejects for "Basic Constraints of CA cert
    not marked critical" — malformed, but tolerated by Windows, hence the
    same truststore approach app/llm/provider.py already uses at runtime):

        raw socket + truststore ctx ......... OK
        httpx + inject_into_ssl() ........... CERTIFICATE_VERIFY_FAILED
        httpx + explicit truststore ctx ..... OK

    The last line also needs the CA present in the container's system trust
    store (the Dockerfile runs update-ca-certificates just above), because
    that is where truststore reads from. Both halves are required.

set_client_factory is a public huggingface_hub export, not a private hook.
"""

from __future__ import annotations

import os
import ssl
import sys

EMBEDDING_MODEL = os.environ.get(
    "EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2"
)
RERANKER_MODEL = os.environ.get(
    "RERANKER_MODEL", "cross-encoder/ms-marco-MiniLM-L-6-v2"
)


def _use_os_trust_store() -> bool:
    """Point huggingface_hub's httpx client at the OS trust store.

    Returns True if the override was installed. Best-effort by design: if
    anything here is unavailable the build should still succeed on a normal
    network, so failures degrade to stock TLS rather than aborting.
    """
    try:
        import httpx
        import truststore
        from huggingface_hub import set_client_factory
    except ImportError:
        return False

    ctx = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    set_client_factory(lambda: httpx.Client(verify=ctx, follow_redirects=True))
    return True


def main() -> int:
    if _use_os_trust_store():
        print("TLS: verifying against the OS trust store (truststore + httpx)")
    else:
        print("TLS: stock verification")

    from sentence_transformers import CrossEncoder, SentenceTransformer

    print(f"Downloading embedding model: {EMBEDDING_MODEL}")
    SentenceTransformer(EMBEDDING_MODEL)
    print(f"Downloading reranker model:  {RERANKER_MODEL}")
    CrossEncoder(RERANKER_MODEL)
    print("Both models cached in the image.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
