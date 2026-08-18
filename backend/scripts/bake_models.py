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

# The embedding model name comes from config/embedding.yaml and NOWHERE else.
# There is no EMBEDDING_MODEL environment variable in the code path: every
# caller resolves the model through load_embedding_config(), and that file says
# so at the top.
#
# Baking from a separate env var let the image and the app disagree silently,
# and the failure mode is badly misleading: embedding_provider.py sets
# HF_HUB_OFFLINE=1 at import, so a model that was not baked is never
# downloaded — startup dies complaining about offline mode rather than about
# the mismatch that actually caused it. Reading the same YAML the app reads
# makes that class of bug impossible.
#
# RERANKER_MODEL stays an env var deliberately: that one IS read from the
# environment, by _load_reranker() in app/api/dependencies.py.
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

    from sentence_transformers import CrossEncoder

    # Reuse the app's own loader rather than re-implementing it. Beyond the
    # model name, the YAML carries load options that change what gets cached
    # (tokenizer padding side, torch dtype), and SentenceTransformerProvider
    # already resolves the processor_kwargs/tokenizer_kwargs rename by
    # signature. Duplicating that here would be a second thing to keep in sync.
    from app.services.retrieval.embedding_provider import (
        SentenceTransformerProvider,
        load_embedding_config,
    )

    # SentenceTransformerProvider.__init__ does
    # os.environ.setdefault("HF_HUB_OFFLINE", "1") — correct at runtime, where
    # the model must already be cached, but fatal at BUILD time when the whole
    # point is to fetch it. setdefault means an existing value wins, so setting
    # these to "0" first keeps the download path open. Without this the bake
    # fails with an offline error while sitting on a working network.
    os.environ["HF_HUB_OFFLINE"] = "0"
    os.environ["TRANSFORMERS_OFFLINE"] = "0"

    cfg = load_embedding_config()
    print(f"baking embedding model: {cfg.name} (dim={cfg.dim})")
    SentenceTransformerProvider(cfg)

    print(f"baking reranker model:  {RERANKER_MODEL}")
    CrossEncoder(RERANKER_MODEL)
    print("Both models cached in the image.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
