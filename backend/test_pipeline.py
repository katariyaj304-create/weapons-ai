"""
Quick test script — tests each pipeline step independently.
"""
import os
import sys
import json
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.chdir(os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv
load_dotenv()

def test_deepseek():
    """Test BOM analysis with DeepSeek-R1."""
    print("\n" + "="*60)
    print("TEST 1: DeepSeek-R1 BOM Analysis")
    print("="*60)
    try:
        from app.tools.deepseek_client import analyze_asset
        start = time.time()
        result = analyze_asset("AK-47 Rifle")
        elapsed = time.time() - start
        print(f"\n✓ SUCCESS in {elapsed:.1f}s")
        print(f"  Asset: {result.get('asset_name')}")
        components = result.get("components", [])
        print(f"  Components: {len(components)}")
        for i, c in enumerate(components):
            print(f"    [{i+1}] {c.get('part_name')} — Risk: {c.get('risk_score')} ({c.get('risk_tier')})")
        
        # Save for next test
        with open("test_bom_result.json", "w") as f:
            json.dump(result, f, indent=2)
        
        return result
    except Exception as e:
        print(f"\n✗ FAILED: {e}")
        import traceback
        traceback.print_exc()
        return None

def test_flux(bom_data):
    """Test FLUX.1-dev image generation."""
    print("\n" + "="*60)
    print("TEST 2: FLUX.1-dev Image Generation")
    print("="*60)
    
    if not bom_data:
        print("Skipping — no BOM data")
        return None
    
    try:
        from app.tools.flux_client import generate_image
        from pathlib import Path
        
        component = bom_data["components"][0]
        prompt = component["hf_flux_prompt"]
        out = str(Path("generated/images/test_component.png").resolve())
        Path("generated/images").mkdir(parents=True, exist_ok=True)
        
        print(f"  Prompt: {prompt[:80]}...")
        start = time.time()
        result = generate_image(prompt, out)
        elapsed = time.time() - start
        
        if result and os.path.exists(result):
            size = os.path.getsize(result)
            print(f"\n✓ SUCCESS in {elapsed:.1f}s — {size/1024:.0f}KB image saved")
            return result
        else:
            print(f"\n✗ FAILED: No output file")
            return None
    except Exception as e:
        print(f"\n✗ FAILED: {e}")
        import traceback
        traceback.print_exc()
        return None

def test_trellis(image_path):
    """Test TRELLIS.2 3D generation."""
    print("\n" + "="*60)
    print("TEST 3: TRELLIS.2 Image-to-3D")
    print("="*60)
    
    if not image_path:
        print("Skipping — no image")
        return None
    
    try:
        from app.tools.trellis_client import generate_3d_model
        from pathlib import Path
        
        out = str(Path("generated/models/test_model.glb").resolve())
        Path("generated/models").mkdir(parents=True, exist_ok=True)
        
        start = time.time()
        result = generate_3d_model(image_path, out)
        elapsed = time.time() - start
        
        if result and os.path.exists(result):
            size = os.path.getsize(result)
            print(f"\n✓ SUCCESS in {elapsed:.1f}s — {size/1024:.0f}KB GLB saved")
            return result
        else:
            print(f"\n! TRELLIS.2 returned None (Space may be cold/unavailable)")
            return None
    except Exception as e:
        print(f"\n✗ FAILED: {e}")
        import traceback
        traceback.print_exc()
        return None

def test_triposr(image_path):
    """Test TripoSR fallback 3D generation."""
    print("\n" + "="*60)
    print("TEST 4: TripoSR Fallback 3D")
    print("="*60)
    
    if not image_path:
        print("Skipping — no image")
        return None
    
    try:
        from app.tools.triposr_client import generate_3d_model
        from pathlib import Path
        
        out = str(Path("generated/models/test_model_tripo.glb").resolve())
        
        start = time.time()
        result = generate_3d_model(image_path, out)
        elapsed = time.time() - start
        
        if result and os.path.exists(result):
            size = os.path.getsize(result)
            print(f"\n✓ SUCCESS in {elapsed:.1f}s — {size/1024:.0f}KB model saved")
            return result
        else:
            print(f"\n! TripoSR returned None")
            return None
    except Exception as e:
        print(f"\n✗ FAILED: {e}")
        import traceback
        traceback.print_exc()
        return None


if __name__ == "__main__":
    print("="*60)
    print("  PROJECT ANTI-GRAVITY — PIPELINE TEST")
    print("="*60)
    
    # Test 1: BOM
    bom = test_deepseek()
    
    if bom:
        # Test 2: Image (first component only)
        img = test_flux(bom)
        
        if img:
            # Test 3: TRELLIS.2
            glb = test_trellis(img)
            
            # Test 4: TripoSR fallback
            if not glb:
                glb = test_triposr(img)
    
    print("\n" + "="*60)
    print("  TEST SUMMARY")
    print("="*60)
    print(f"  BOM Analysis:    {'✓' if bom else '✗'}")
    print(f"  Image Gen:       {'✓' if bom and 'img' in dir() and img else '✗'}")
    print(f"  3D Conversion:   {'✓' if bom and 'glb' in dir() and glb else '✗'}")
    print("="*60)
