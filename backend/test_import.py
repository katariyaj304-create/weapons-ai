import sys

print("Python path:", sys.path)

try:
    from tactical_intelligence_dossier import gather_factual_data
    print("Import successful.")
except ModuleNotFoundError as e:
    print(f"Module not found: {e}")