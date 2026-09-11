from search_query_optimizer import optimize_search_query
from image_validator import is_valid_image
from tripo3d_prompt_generator import generate_tripod3d_prompt
from tactical_intelligence_dossier import gather_factual_data

def main(weapon_name, image_path=None):
    # Step 1: Optimize the search query
    optimized_query = optimize_search_query(weapon_name)
    print(f"Optimized Query: {optimized_query}")

    # Step 2: Validate the image (if an image path is provided)
    if image_path:
        is_valid, message = is_valid_image(image_path)
        print(f"Image Validation - Is Valid: {is_valid}, Message: {message}")
        if not is_valid:
            return

    # Step 3: Generate the Tripo3D prompt
    tripod3d_prompt = generate_tripod3d_prompt(weapon_name)
    print(f"Tripo3D Prompt: {tripod3d_prompt}")

    # Step 4: Gather factual data using Tavily Deep Research
    dossier = gather_factual_data(weapon_name)
    if dossier:
        print("Tactical Intelligence Dossier:")
        print(dossier)

if __name__ == "__main__":
    # Example usage
    weapon_name = "AR15 rifle"
    image_path = "path/to/image.jpg"  # Optional: provide an image path for validation
    main(weapon_name, image_path)