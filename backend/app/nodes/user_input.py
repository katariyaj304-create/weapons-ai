"""
User Input Node — validates and normalizes the input model name.
"""


def user_input_node(state: dict) -> dict:
    """
    First node in the graph: validates the model name and prepares context.
    """
    model_name = state.get("model_name", "").strip()

    if not model_name:
        return {
            **state,
            "error": "No model name provided.",
            "status": "error"
        }

    # Normalize the model name
    normalized_name = model_name.title()

    # Extract mesh names if provided (from uploaded GLB files)
    mesh_names = state.get("mesh_names", [])

    return {
        **state,
        "model_name": normalized_name,
        "mesh_names": mesh_names,
        "status": "input_validated"
    }
