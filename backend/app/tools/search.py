"""
Tavily search tool for deep web research.
"""
import os
from tavily import TavilyClient


def search_web(query: str, max_results: int = 5) -> str:
    """
    Search the web using Tavily API and return compiled results.
    """
    api_key = os.getenv("TAVILY_API_KEY")
    if not api_key:
        return "Error: TAVILY_API_KEY not set in environment variables."

    client = TavilyClient(api_key=api_key)

    try:
        response = client.search(
            query=query,
            search_depth="advanced",
            max_results=max_results,
            include_answer=True
        )

        results = []

        # Include the AI-generated answer if available
        if response.get("answer"):
            results.append(f"## Summary\n{response['answer']}\n")

        # Include individual search results
        for i, result in enumerate(response.get("results", []), 1):
            title = result.get("title", "No title")
            content = result.get("content", "No content")
            url = result.get("url", "")
            results.append(f"### Source {i}: {title}\n{content}\nURL: {url}\n")

        return "\n".join(results) if results else "No results found."

    except Exception as e:
        return f"Search error: {str(e)}"


def _queries(model_name: str) -> dict:
    return {
        "history": f"history and evolution of {model_name}, when was it invented, historical development",
        "materials": f"what materials are used to build {model_name}, construction materials, manufacturing",
        "functionality": f"how does {model_name} work, mechanism, functionality, technical operation",
        "parts": f"{model_name} main components parts diagram, labeled parts, anatomy breakdown",
        "general": f"{model_name} educational overview, interesting facts, applications, uses",
    }


def multi_search(model_name: str) -> dict:
    """
    Perform multiple targeted searches for comprehensive research.
    """
    return {key: search_web(query, max_results=3) for key, query in _queries(model_name).items()}


def search_structured(query: str, max_results: int = 4) -> dict:
    """Return Tavily's grounded answer plus its sources, instead of one flat string.

    Used by the research node's extractive fallback so a synthesis LLM outage still
    yields real, source-backed text rather than an error message.
    """
    api_key = os.getenv("TAVILY_API_KEY")
    if not api_key:
        return {"answer": "", "sources": []}

    try:
        response = TavilyClient(api_key=api_key).search(
            query=query,
            search_depth="advanced",
            max_results=max_results,
            include_answer=True,
        )
    except Exception as e:
        print(f"[Search] structured search failed: {e}")
        return {"answer": "", "sources": []}

    sources = [
        {
            "title": r.get("title", ""),
            "content": (r.get("content") or "").strip(),
            "url": r.get("url", ""),
        }
        for r in response.get("results", [])
        if (r.get("content") or "").strip()
    ]
    return {"answer": (response.get("answer") or "").strip(), "sources": sources}


def multi_search_structured(model_name: str) -> dict:
    """Structured variant of multi_search — {section: {answer, sources}}."""
    return {key: search_structured(query) for key, query in _queries(model_name).items()}
