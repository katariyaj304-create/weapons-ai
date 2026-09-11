def generate_tripod3d_prompt(weapon_name):
    # Generate a prompt for the Tripo3D API
    optimized_query = optimize_search_query(weapon_name)
    prompt = f"{optimized_query} Industrial design, hard-surface topology, uniform mechanical symmetry, rigid body, high-fidelity tactical asset, un-fused clean barrel chamber, PBR material ready."
    return prompt

if __name__ == "__main__":
    # Example usage
    weapon_name = "AR15 rifle"
    print(generate_tripod3d_prompt(weapon_name))