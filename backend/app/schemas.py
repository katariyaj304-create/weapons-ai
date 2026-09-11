"""
Pydantic schemas for request/response models.
"""
from pydantic import BaseModel, Field
from typing import List, Optional


class ResearchRequest(BaseModel):
    """Request to research a 3D model object."""
    model_name: str = Field(..., description="Name of the 3D model/object to research")
    mesh_names: Optional[List[str]] = Field(
        default=None,
        description="List of actual mesh names from the uploaded GLB file"
    )


class PartAnnotation(BaseModel):
    """A single part annotation for a 3D model."""
    part_name: str = Field(..., description="Human-readable name of the part")
    mesh_id: str = Field(..., description="Mesh name/ID in the 3D model file")
    description: str = Field(..., description="Educational description of this part")
    color: str = Field(default="#00d4ff", description="Hex color for blueprint highlight")
    category: str = Field(default="structural", description="Category: structural, mechanical, electronic, fluid, etc.")


class ResearchResponse(BaseModel):
    """Full research response with 3D mapping data."""
    model_name: str
    history: str = Field(..., description="Historical background and evolution")
    materials: str = Field(..., description="Materials used in construction")
    general_info: str = Field(..., description="General educational information")
    functionality: str = Field(..., description="How the object works")
    parts: List[PartAnnotation] = Field(default_factory=list, description="Identified parts with mesh mappings")


# ============================================
# Asset Generation Pipeline Schemas
# ============================================

class AssetGenerationRequest(BaseModel):
    """Request to generate a 3D asset via the multi-model pipeline."""
    asset_name: str = Field(..., description="Name of the tactical asset to generate")


class BOMComponent(BaseModel):
    """Single component in the Bill of Materials."""
    part_name: str
    hf_flux_prompt: str
    material_dependency: str
    risk_score: int
    risk_tier: str  # CRITICAL, ELEVATED, STABLE
    image_url: Optional[str] = None
    glb_url: Optional[str] = None
    model_source: Optional[str] = None  # "trellis" or "triposr"


class AssetGenerationResponse(BaseModel):
    """Full response from the asset generation pipeline."""
    asset_name: str
    components: List[BOMComponent]
    overall_risk: float = 0.0
    pipeline_status: str = "complete"


# ============================================
# Direct 3D Generation Schemas (name -> image -> 3D)
# ============================================

class Direct3DGenerationRequest(BaseModel):
    """Request to generate a single 3D model directly from a weapon name."""
    weapon_name: str = Field(..., description="Name of the weapon/asset to visualize in 3D")


class Direct3DGenerationResponse(BaseModel):
    """Response from the weapon-name -> best-image -> Hunyuan3D-2.1 pipeline."""
    weapon_name: str
    source_image_url: Optional[str] = None
    source_url: Optional[str] = None
    preprocessed_image_url: Optional[str] = None
    glb_url: Optional[str] = None
    model_source: Optional[str] = None
    status: str = "complete"


# ============================================
# FreeCAD Master AI Generation Schemas
# ============================================

class FreeCADGenerationRequest(BaseModel):
    """Request for 5-pass FreeCAD AI model generation."""
    asset_name: str = Field(..., description="Name of the weapon, tank, or armor asset (e.g. 'Arjun Main Battle Tank', 'AR-15')")
    enable_web_search: bool = Field(default=True, description="Whether to search internet for real-world blueprints & dimensions")
    time_limit: int = Field(default=360, description="Max time in seconds (default 6 min for complex assets)")
    quality_threshold: int = Field(default=75, description="Quality score threshold 0-100")
    max_iterations: int = Field(default=8)


class FreeCADPassLog(BaseModel):
    """A single pass log in the 5-pass iterative CAD engine."""
    pass_number: int = Field(..., alias="pass")
    name: str
    status: str
    details: str


class FreeCADGenerationResponse(BaseModel):
    """Full response from the FreeCAD Master AI generator."""
    status: str = "complete"
    asset_name: str
    glb_url: str
    script_url: str
    step_url: Optional[str] = None
    stl_url: Optional[str] = None
    fcstd_url: Optional[str] = None
    web_specs: Optional[dict] = None
    kit_info: Optional[dict] = None
    pass_logs: List[dict] = Field(default_factory=list)
    freecad_status: Optional[dict] = None
    recommended_hf_models: List[dict] = Field(default_factory=list)
    freecad_script_content: Optional[str] = None
    ai_reasoning: Optional[str] = None
    iterations: List[dict] = Field(default_factory=list)
    final_score: Optional[int] = None
    mcp_connected: bool = False
    execution_log: Optional[dict] = None


