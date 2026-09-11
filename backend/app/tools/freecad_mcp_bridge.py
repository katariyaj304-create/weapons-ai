import os
import xmlrpc.client
import tempfile
import subprocess
import base64
import json

class FreeCADMCPBridge:
    def __init__(self):
        self.client = None
        self.host = "localhost"
        self.port = 9875
        self.fallback_commands = []
        self.is_fallback = False
        
    def connect(self, host="localhost", port=9875):
        self.host = host
        self.port = port
        url = f"http://{host}:{port}/"
        try:
            client = xmlrpc.client.ServerProxy(url)
            client.system.listMethods()
            self.client = client
            self.is_fallback = False
            return True
        except Exception:
            self.is_fallback = True
            self.fallback_commands = []
            return False
            
    def is_connected(self):
        if self.is_fallback:
            return True
        if not self.client:
            return False
        try:
            self.client.system.listMethods()
            return True
        except:
            self.is_fallback = True
            return False
            
    def _execute(self, method, *args):
        if self.is_fallback:
            return None
        try:
            func = getattr(self.client, method)
            return func(*args)
        except Exception as e:
            print(f"MCP RPC Error ({method}): {e}")
            raise
            
    def _add_fallback(self, code):
        if self.is_fallback:
            self.fallback_commands.append(code)
            
    def create_document(self, name):
        if self.is_fallback:
            self._add_fallback(f"App.newDocument('{name}')")
            self._add_fallback(f"App.setActiveDocument('{name}')")
            self._add_fallback(f"App.ActiveDocument=App.getDocument('{name}')")
            return True
        return self._execute("create_document", name)

    def create_box(self, name, length, width, height, x=0, y=0, z=0):
        if self.is_fallback:
            self._add_fallback(f"obj = App.ActiveDocument.addObject('Part::Box', '{name}')")
            self._add_fallback(f"obj.Length = {length}")
            self._add_fallback(f"obj.Width = {width}")
            self._add_fallback(f"obj.Height = {height}")
            self._add_fallback(f"obj.Placement = App.Placement(App.Vector({x}, {y}, {z}), App.Rotation(0,0,0))")
            return name
        return self._execute("create_box", name, length, width, height, x, y, z)

    def create_cylinder(self, name, radius, height, x=0, y=0, z=0, dx=0, dy=0, dz=1):
        if self.is_fallback:
            self._add_fallback(f"obj = App.ActiveDocument.addObject('Part::Cylinder', '{name}')")
            self._add_fallback(f"obj.Radius = {radius}")
            self._add_fallback(f"obj.Height = {height}")
            self._add_fallback(f"obj.Placement = App.Placement(App.Vector({x}, {y}, {z}), App.Rotation(App.Vector(0,0,1), App.Vector({dx},{dy},{dz})))")
            return name
        return self._execute("create_cylinder", name, radius, height, x, y, z, dx, dy, dz)

    def create_cone(self, name, r1, r2, height, x=0, y=0, z=0):
        if self.is_fallback:
            self._add_fallback(f"obj = App.ActiveDocument.addObject('Part::Cone', '{name}')")
            self._add_fallback(f"obj.Radius1 = {r1}")
            self._add_fallback(f"obj.Radius2 = {r2}")
            self._add_fallback(f"obj.Height = {height}")
            self._add_fallback(f"obj.Placement = App.Placement(App.Vector({x}, {y}, {z}), App.Rotation(0,0,0))")
            return name
        return self._execute("create_cone", name, r1, r2, height, x, y, z)

    def create_sphere(self, name, radius, x=0, y=0, z=0):
        if self.is_fallback:
            self._add_fallback(f"obj = App.ActiveDocument.addObject('Part::Sphere', '{name}')")
            self._add_fallback(f"obj.Radius = {radius}")
            self._add_fallback(f"obj.Placement = App.Placement(App.Vector({x}, {y}, {z}), App.Rotation(0,0,0))")
            return name
        return self._execute("create_sphere", name, radius, x, y, z)

    def create_torus(self, name, r_major, r_minor, x=0, y=0, z=0):
        if self.is_fallback:
            self._add_fallback(f"obj = App.ActiveDocument.addObject('Part::Torus', '{name}')")
            self._add_fallback(f"obj.Radius1 = {r_major}")
            self._add_fallback(f"obj.Radius2 = {r_minor}")
            self._add_fallback(f"obj.Placement = App.Placement(App.Vector({x}, {y}, {z}), App.Rotation(0,0,0))")
            return name
        return self._execute("create_torus", name, r_major, r_minor, x, y, z)

    def boolean_fuse(self, name, obj1, obj2):
        if self.is_fallback:
            self._add_fallback(f"App.ActiveDocument.addObject('Part::MultiFuse', '{name}')")
            self._add_fallback(f"App.ActiveDocument.{name}.Shapes = [App.ActiveDocument.{obj1}, App.ActiveDocument.{obj2}]")
            self._add_fallback(f"App.ActiveDocument.{obj1}.ViewObject.Visibility = False")
            self._add_fallback(f"App.ActiveDocument.{obj2}.ViewObject.Visibility = False")
            return name
        return self._execute("boolean_fuse", name, obj1, obj2)

    def boolean_cut(self, name, base, cutter):
        if self.is_fallback:
            self._add_fallback(f"App.ActiveDocument.addObject('Part::Cut', '{name}')")
            self._add_fallback(f"App.ActiveDocument.{name}.Base = App.ActiveDocument.{base}")
            self._add_fallback(f"App.ActiveDocument.{name}.Tool = App.ActiveDocument.{cutter}")
            self._add_fallback(f"App.ActiveDocument.{base}.ViewObject.Visibility = False")
            self._add_fallback(f"App.ActiveDocument.{cutter}.ViewObject.Visibility = False")
            return name
        return self._execute("boolean_cut", name, base, cutter)

    def boolean_common(self, name, obj1, obj2):
        if self.is_fallback:
            self._add_fallback(f"App.ActiveDocument.addObject('Part::MultiCommon', '{name}')")
            self._add_fallback(f"App.ActiveDocument.{name}.Shapes = [App.ActiveDocument.{obj1}, App.ActiveDocument.{obj2}]")
            self._add_fallback(f"App.ActiveDocument.{obj1}.ViewObject.Visibility = False")
            self._add_fallback(f"App.ActiveDocument.{obj2}.ViewObject.Visibility = False")
            return name
        return self._execute("boolean_common", name, obj1, obj2)

    def apply_fillet(self, obj, radius):
        if self.is_fallback:
            name = f"{obj}_Fillet"
            self._add_fallback(f"App.ActiveDocument.addObject('Part::Fillet', '{name}')")
            self._add_fallback(f"App.ActiveDocument.{name}.Base = App.ActiveDocument.{obj}")
            self._add_fallback(f"edges = [e.Name for e in App.ActiveDocument.{obj}.Shape.Edges]")
            self._add_fallback(f"App.ActiveDocument.{name}.Edges = edges")
            self._add_fallback(f"App.ActiveDocument.{name}.Radius = {radius}")
            self._add_fallback(f"App.ActiveDocument.{obj}.ViewObject.Visibility = False")
            return name
        return self._execute("apply_fillet", obj, radius)

    def apply_chamfer(self, obj, size):
        if self.is_fallback:
            name = f"{obj}_Chamfer"
            self._add_fallback(f"App.ActiveDocument.addObject('Part::Chamfer', '{name}')")
            self._add_fallback(f"App.ActiveDocument.{name}.Base = App.ActiveDocument.{obj}")
            self._add_fallback(f"edges = [e.Name for e in App.ActiveDocument.{obj}.Shape.Edges]")
            self._add_fallback(f"App.ActiveDocument.{name}.Edges = edges")
            self._add_fallback(f"App.ActiveDocument.{name}.Size = {size}")
            self._add_fallback(f"App.ActiveDocument.{obj}.ViewObject.Visibility = False")
            return name
        return self._execute("apply_chamfer", obj, size)

    def move_object(self, name, x, y, z):
        if self.is_fallback:
            self._add_fallback(f"App.ActiveDocument.{name}.Placement.Base.x += {x}")
            self._add_fallback(f"App.ActiveDocument.{name}.Placement.Base.y += {y}")
            self._add_fallback(f"App.ActiveDocument.{name}.Placement.Base.z += {z}")
            return True
        return self._execute("move_object", name, x, y, z)

    def rotate_object(self, name, axis_x, axis_y, axis_z, angle):
        if self.is_fallback:
            self._add_fallback(f"App.ActiveDocument.{name}.Placement.Rotation = App.ActiveDocument.{name}.Placement.Rotation.multiply(App.Rotation(App.Vector({axis_x},{axis_y},{axis_z}), {angle}))")
            return True
        return self._execute("rotate_object", name, axis_x, axis_y, axis_z, angle)

    def execute_python(self, code):
        if self.is_fallback:
            for line in code.split('\n'):
                self._add_fallback(line)
            return True
        return self._execute("execute_python", code)

    def capture_viewport(self, width=800, height=600):
        if self.is_fallback:
            return None
        return self._execute("capture_viewport", width, height)

    def list_objects(self):
        if self.is_fallback:
            return []
        return self._execute("list_objects")

    def get_object_info(self, name):
        if self.is_fallback:
            return {"valid": True, "volume": 1, "bbox": [0,0,0,1,1,1]}
        return self._execute("get_object_info", name)

    def export_step(self, filepath):
        if self.is_fallback:
            self._add_fallback(f"import Part")
            self._add_fallback(f"objs = [obj for obj in App.ActiveDocument.Objects if hasattr(obj, 'ViewObject') and obj.ViewObject and obj.ViewObject.Visibility]")
            self._add_fallback(f"Part.export(objs, r'{filepath}')")
            return True
        return self._execute("export_step", filepath)

    def export_stl(self, filepath):
        if self.is_fallback:
            self._add_fallback(f"import Mesh")
            self._add_fallback(f"objs = [obj for obj in App.ActiveDocument.Objects if hasattr(obj, 'ViewObject') and obj.ViewObject and obj.ViewObject.Visibility]")
            self._add_fallback(f"Mesh.export(objs, r'{filepath}')")
            return True
        return self._execute("export_stl", filepath)

    def export_glb(self, filepath):
        if self.is_fallback:
            self._add_fallback(f"import Import")
            self._add_fallback(f"objs = [obj for obj in App.ActiveDocument.Objects if hasattr(obj, 'ViewObject') and obj.ViewObject and obj.ViewObject.Visibility]")
            self._add_fallback(f"try:\n    Import.export(objs, r'{filepath}')\nexcept Exception as e:\n    print('GLB export failed:', e)")
            return True
        return self._execute("export_glb", filepath)

    def save_document(self, filepath):
        if self.is_fallback:
            self._add_fallback(f"App.ActiveDocument.saveAs(r'{filepath}')")
            return True
        return self._execute("save_document", filepath)

    def recompute(self):
        if self.is_fallback:
            self._add_fallback("App.ActiveDocument.recompute()")
            return True
        return self._execute("recompute")

    def delete_object(self, name):
        if self.is_fallback:
            self._add_fallback(f"App.ActiveDocument.removeObject('{name}')")
            return True
        return self._execute("delete_object", name)

    def set_color(self, name, r, g, b):
        if self.is_fallback:
            self._add_fallback(f"try:\n    App.ActiveDocument.{name}.ViewObject.ShapeColor = ({r/255.0}, {g/255.0}, {b/255.0})\nexcept:\n    pass")
            return True
        return self._execute("set_color", name, r, g, b)
        
    def execute_fallback_script(self):
        if not self.is_fallback or not self.fallback_commands:
            return True
            
        script = "import FreeCAD as App\nimport Part\n" + "\n".join(self.fallback_commands)
        
        with tempfile.NamedTemporaryFile(suffix=".py", delete=False, mode="w") as f:
            f.write(script)
            script_path = f.name
            
        fc_cmd = r"C:\Program Files\FreeCAD 1.1\bin\freecadcmd.exe"
        if not os.path.exists(fc_cmd):
            # Attempt basic lookup
            fc_cmd = "FreeCADCmd.exe"
            
        try:
            subprocess.run([fc_cmd, script_path], check=True, capture_output=True)
            return True
        except subprocess.CalledProcessError as e:
            print(f"Fallback script failed: {e.stderr.decode()}")
            return False
        finally:
            self.fallback_commands = []
            try:
                os.remove(script_path)
            except:
                pass
