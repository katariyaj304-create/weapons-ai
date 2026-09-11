import os
import shutil
import urllib.request
import zipfile
import winreg
import xmlrpc.client
import subprocess

def detect_freecad():
    paths_to_check = [
        r"C:\Program Files\FreeCAD 1.1\bin\FreeCADCmd.exe",
        r"C:\Program Files\FreeCAD 1.0\bin\FreeCADCmd.exe",
        r"C:\Program Files\FreeCAD 0.21\bin\FreeCADCmd.exe",
    ]
    if "FREECAD_PATH" in os.environ:
        paths_to_check.insert(0, os.environ["FREECAD_PATH"])
        
    for p in paths_to_check:
        if os.path.exists(p):
            return os.path.dirname(p)
            
    try:
        key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\FreeCAD1.1")
        val, _ = winreg.QueryValueEx(key, "InstallLocation")
        path = os.path.join(val, "bin", "FreeCADCmd.exe")
        if os.path.exists(path):
            return os.path.dirname(path)
    except Exception:
        pass
    return None

def check_mcp_addon_installed():
    appdata = os.getenv("APPDATA")
    if not appdata:
        return False
    addon_path = os.path.join(appdata, "FreeCAD", "Mod", "FreeCADMCP")
    return os.path.isdir(addon_path)

def install_mcp_addon():
    appdata = os.getenv("APPDATA")
    if not appdata:
        return False
    mods_dir = os.path.join(appdata, "FreeCAD", "Mod")
    os.makedirs(mods_dir, exist_ok=True)
    
    url = "https://github.com/neka-nat/freecad-mcp/archive/refs/heads/main.zip"
    zip_path = os.path.join(mods_dir, "freecad-mcp.zip")
    
    try:
        urllib.request.urlretrieve(url, zip_path)
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(mods_dir)
            
        extracted_dir = os.path.join(mods_dir, "freecad-mcp-main")
        final_dir = os.path.join(mods_dir, "FreeCADMCP")
        
        if os.path.exists(final_dir):
            shutil.rmtree(final_dir)
            
        os.rename(extracted_dir, final_dir)
        os.remove(zip_path)
        return True
    except Exception as e:
        print(f"Failed to install MCP addon: {e}")
        return False

def check_mcp_server_running(host="localhost", port=9875):
    try:
        client = xmlrpc.client.ServerProxy(f"http://{host}:{port}/")
        client.system.listMethods()
        return True
    except Exception:
        return False

def launch_freecad_with_mcp():
    bin_dir = detect_freecad()
    if not bin_dir:
        return False
        
    exe_path = os.path.join(bin_dir, "FreeCAD.exe")
    if not os.path.exists(exe_path):
        return False
        
    try:
        subprocess.Popen([exe_path])
        return True
    except Exception as e:
        print(f"Failed to launch FreeCAD: {e}")
        return False

def get_full_status():
    bin_dir = detect_freecad()
    return {
        "freecad_found": bool(bin_dir),
        "freecad_path": bin_dir,
        "mcp_addon_installed": check_mcp_addon_installed(),
        "mcp_server_running": check_mcp_server_running()
    }
