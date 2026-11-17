"""The rule books: the documents every convention of the study is read from.

Each entry is fetched once into the cache and its manifest entry names it; the
figures the study takes from it are held in ffabasis.conventions with their
page. None of these documents is redistributed.
"""

from __future__ import annotations

from dataclasses import dataclass

from .http import Fetcher


@dataclass(frozen=True)
class Document:
    key: str
    url: str
    title: str
    publisher: str
    licence: str


DOCUMENTS: tuple[Document, ...] = (
    Document(
        "baltic_gmb_current",
        "https://www.balticexchange.com/content/dam/balticexchange/consumer/documents/data-services/documentation/"
        "ocean-bulk-guides-policies/GMB.pdf",
        "Guide to Market Benchmarks (current version)",
        "Baltic Exchange Information Services Ltd",
        "Baltic copyright; figures cited with page, not redistributed",
    ),
    Document(
        "baltic_gmb_legacy_path",
        "https://www.balticexchange.com/content/dam/balticexchange/consumer/data-services-/documents-/ocean-bulk/GMB.pdf",
        "Guide to Market Benchmarks (the copy at the guide's former address)",
        "Baltic Exchange Information Services Ltd",
        "Baltic copyright; figures cited with page, not redistributed",
    ),
    Document(
        "baltic_td3c_tce_note_2017",
        "https://www.balticexchange.com/content/dam/balticexchange/consumer/data-services-/historicalcircular_docs/"
        "TD3C-TCE_Calculation_Process_0717.pdf",
        "TD3C TCE calculation process (July 2017)",
        "Baltic Exchange",
        "Baltic copyright; figures cited, not redistributed",
    ),
    Document(
        "baltic_bii_whitepaper_2024",
        "https://www.balticexchange.com/content/dam/balticexchange/consumer/documents/BII Whitepaper 2024.pdf",
        "Baltic Investor Indices white paper (2024)",
        "Baltic Exchange",
        "Baltic copyright; figures cited, not redistributed",
    ),
    Document(
        "eex_contract_specs_047a",
        "https://www.eex.com/fileadmin/EEX/Downloads/Rules/EEX-Contract_Specifications_for_Trade_Registration/"
        "20260723_EEX_Contract_Specifications_for_Trade_Registration_047a_EN_FINAL.pdf",
        "EEX Contract Specifications for Trade Registration, release 047a (23 July 2026)",
        "European Energy Exchange AG",
        "Copyright of the publisher; cited, not redistributed",
    ),
    Document(
        "ice_tdl_spec",
        "https://www.ice.com/api/productguide/spec/57250507/pdf",
        "ICE Futures Europe, TD3C FFA (TDL) contract specification",
        "Intercontinental Exchange",
        "Copyright of the publisher; cited, not redistributed",
    ),
    Document(
        "maritimeprofessional_baltic_2026_07_29",
        "https://www.maritimeprofessional.com/amp/news/baltic-index-drops-four-week-421570",
        "Reuters, 'Baltic Index Drops to Four Week Low', 29 July 2026, as republished by Maritime Professional",
        "Maritime Professional (New Wave Media), Reuters text",
        "Copyright of the publisher; cached, not redistributed",
    ),
    Document(
        "eia_tie_67386",
        "https://www.eia.gov/todayinEnergy/detail.php?id=67386",
        "EIA, Today in Energy, 26 March 2026",
        "US Energy Information Administration",
        "US Government work, public domain",
    ),
)


def fetch_all(fetcher: Fetcher, only: tuple[str, ...] = ()) -> dict[str, str]:
    """Fetch every rule book (or those named); returns key -> status words."""
    status: dict[str, str] = {}
    for doc in DOCUMENTS:
        if only and doc.key not in only:
            continue
        try:
            path = fetcher.get(doc.url, key=doc.key, source=doc.publisher, licence=doc.licence)
            status[doc.key] = f"cached {path.stat().st_size} bytes"
        except Exception as error:  # recorded, reported, never silent
            status[doc.key] = f"failed: {error}"
    return status
