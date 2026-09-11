def optimize_search_query(weapon_name):
    # Strip conversational fluff and append precise orthographic constraints
    optimized_query = f"{weapon_name} orthographic side profile, studio lighting, isolated white background"
    return optimized_query

if __name__ == "__main__":
    # Example usage
    weapon_name = "AR15 rifle"
    print(optimize_search_query(weapon_name))