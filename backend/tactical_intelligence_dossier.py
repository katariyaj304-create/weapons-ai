import requests
from os import environ
from tavily_python import TavilyClient

def gather_factual_data(weapon_name):
    api_key = environ.get('TAVILY_API_KEY')
    if not api_key:
        raise ValueError("TAVILY_API_KEY environment variable is not set.")
    client = TavilyClient(api_key=api_key)
    response = client.search(query=weapon_name)
    
    if not response.results:
        return None
    
    dossier = {
        "serial": f"ASSET-{response.results[0].id}",
        "specs": [
            { "label": "Origin Country", "value": "" },
            { "label": "Classification", "value": "" },
            { "label": "Caliber / Payload", "value": "" },
            { "label": "Effective Range", "value": "" },
            { "label": "Primary Material", "value": "" }
        ],
        "annotations": [
            { "mesh_component": "Muzzle/Barrel", "intel": "" },
            { "mesh_component": "Receiver/Chassis", "intel": "" },
            { "mesh_component": "Stock/Stabilizer", "intel": "" }
        ]
    }
    
    # Extract data from Tavily search results
    for result in response.results:
        import re

        # Use regular expressions to extract values more reliably
        origin_country_match = re.search(r'origin country:\s*(.+)', result.snippet, re.IGNORECASE)
        classification_match = re.search(r'classification:\s*(.+)', result.snippet, re.IGNORECASE)
        caliber_payload_match = re.search(r'(caliber|payload):\s*(.+)', result.snippet, re.IGNORECASE)
        effective_range_match = re.search(r'effective range:\s*(.+)', result.snippet, re.IGNORECASE)
        primary_material_match = re.search(r'primary material:\s*(.+)', result.snippet, re.IGNORECASE)

        if origin_country_match:
            dossier["specs"][0]["value"] = origin_country_match.group(1).strip()
        if classification_match:
            dossier["specs"][1]["value"] = classification_match.group(1).strip()
        if caliber_payload_match:
            dossier["specs"][2]["value"] = caliber_payload_match.group(1).strip()
        if effective_range_match:
            dossier["specs"][3]["value"] = effective_range_match.group(1).strip()
        if primary_material_match:
            dossier["specs"][4]["value"] = primary_material_match.group(1).strip()
    
    # Further processing can be done to enhance the dossier based on additional data extraction logic
    
    return dossier

if __name__ == "__main__":
    # Example usage
    weapon_name = "AR15 rifle"
    dossier = gather_factual_data(weapon_name)
    if dossier:
        print(dossier)