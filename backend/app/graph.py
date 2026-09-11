"""
LangGraph State Machine — orchestrates the 3-node research pipeline
AND the 3-stage asset generation pipeline.
"""
from typing import TypedDict, List, Optional, Any
from langgraph.graph import StateGraph, END

from app.nodes.user_input import user_input_node
from app.nodes.research import deep_research_node
from app.nodes.mapping import mapping_node
from app.nodes.pipeline import bom_analysis_node, image_generation_node, model_generation_node
from app.nodes.direct3d import find_image_node, preprocess_image_node, generate_model_node


class ResearchState(TypedDict):
    """State that flows through the LangGraph pipeline."""
    model_name: str
    mesh_names: Optional[List[str]]
    search_results: Optional[dict]
    research_data: Optional[dict]
    parts: Optional[List[dict]]
    status: str
    error: Optional[str]


class AssetGenerationState(TypedDict):
    """State that flows through the asset generation pipeline."""
    asset_name: str
    bom_data: Optional[dict]
    image_paths: Optional[List[str]]
    model_paths: Optional[List[str]]
    status: str
    error: Optional[str]


class Direct3DState(TypedDict):
    """State that flows through the direct name -> image -> 3D pipeline."""
    weapon_name: str
    source_image_path: Optional[str]
    source_image_url: Optional[str]
    source_url: Optional[str]
    preprocessed_path: Optional[str]
    preprocessed_url: Optional[str]
    glb_url: Optional[str]
    model_source: Optional[str]
    status: str
    error: Optional[str]


def should_continue(state: dict) -> str:
    """Determine if the pipeline should continue or stop on error."""
    if state.get("status") == "error":
        return "end"
    return "continue"


def build_research_graph():
    """
    Build the LangGraph state machine with 3 nodes:
    1. User Input → validates and normalizes
    2. Deep Research → Tavily search + LLM synthesis
    3. 3D Mapping → structures parts with mesh IDs
    """
    workflow = StateGraph(ResearchState)

    # Add nodes
    workflow.add_node("user_input", user_input_node)
    workflow.add_node("deep_research", deep_research_node)
    workflow.add_node("3d_mapping", mapping_node)

    # Set entry point
    workflow.set_entry_point("user_input")

    # Add edges with conditional routing
    workflow.add_conditional_edges(
        "user_input",
        should_continue,
        {
            "continue": "deep_research",
            "end": END
        }
    )

    workflow.add_conditional_edges(
        "deep_research",
        should_continue,
        {
            "continue": "3d_mapping",
            "end": END
        }
    )

    workflow.add_edge("3d_mapping", END)

    # Compile and return
    return workflow.compile()


def _validate_asset_input(state: dict) -> dict:
    """Validate asset generation input."""
    asset_name = state.get("asset_name", "").strip()
    if not asset_name:
        return {**state, "status": "error", "error": "No asset name provided"}
    return {**state, "asset_name": asset_name, "status": "validated"}


def build_asset_generation_graph():
    """
    Build the LangGraph state machine for asset generation:
    1. Validate Input
    2. BOM Analysis (DeepSeek-R1)
    3. Image Generation (FLUX.1-dev)
    4. 3D Model Generation (TRELLIS.2 + TripoSR)
    """
    workflow = StateGraph(AssetGenerationState)

    # Add nodes
    workflow.add_node("validate_input", _validate_asset_input)
    workflow.add_node("bom_analysis", bom_analysis_node)
    workflow.add_node("image_generation", image_generation_node)
    workflow.add_node("model_generation", model_generation_node)

    # Set entry point
    workflow.set_entry_point("validate_input")

    # Edges
    workflow.add_conditional_edges(
        "validate_input",
        should_continue,
        {"continue": "bom_analysis", "end": END}
    )
    workflow.add_conditional_edges(
        "bom_analysis",
        should_continue,
        {"continue": "image_generation", "end": END}
    )
    workflow.add_conditional_edges(
        "image_generation",
        should_continue,
        {"continue": "model_generation", "end": END}
    )
    workflow.add_edge("model_generation", END)

    return workflow.compile()


def _validate_direct3d_input(state: dict) -> dict:
    """Validate direct 3D generation input."""
    weapon_name = state.get("weapon_name", "").strip()
    if not weapon_name:
        return {**state, "status": "error", "error": "No weapon name provided"}
    return {**state, "weapon_name": weapon_name, "status": "validated"}


def build_direct3d_graph():
    """
    Build the LangGraph state machine for direct name-to-3D generation:
    1. Validate Input
    2. Find Best Image (web image search)
    3. Preprocess Image (background removal, crop, normalize)
    4. Generate 3D Model (Hunyuan3D-2.1)
    """
    workflow = StateGraph(Direct3DState)

    workflow.add_node("validate_input", _validate_direct3d_input)
    workflow.add_node("find_image", find_image_node)
    workflow.add_node("preprocess_image", preprocess_image_node)
    workflow.add_node("generate_model", generate_model_node)

    workflow.set_entry_point("validate_input")

    workflow.add_conditional_edges(
        "validate_input",
        should_continue,
        {"continue": "find_image", "end": END}
    )
    workflow.add_conditional_edges(
        "find_image",
        should_continue,
        {"continue": "preprocess_image", "end": END}
    )
    workflow.add_conditional_edges(
        "preprocess_image",
        should_continue,
        {"continue": "generate_model", "end": END}
    )
    workflow.add_edge("generate_model", END)

    return workflow.compile()


# Pre-compiled graph instances
research_graph = build_research_graph()
asset_generation_graph = build_asset_generation_graph()
direct3d_graph = build_direct3d_graph()
