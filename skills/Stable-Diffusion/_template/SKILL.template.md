# Stable-Diffusion

Generates images by calling a Stable Diffusion WebUI Forge server via its REST API using a local script.
Use sd-t2i.sh for Mac or sd-t2i.ps1 for Windows.

### Usage
- --prompt "<text>" (required): the user prompt for this run.
- --template /path/to/<model.json> (required): model-specific defaults (steps/cfg/sampler/size/model/hires params), saved under /Skills/Stable-Diffusion/templates. **It needs an absolute path or relative path.**
- --upscale (optional): enable Hires Fix (disabled by default).
- --host <url:port> (optional): Forge base URL (default http://127.0.0.1:7860), **INCLUDE THE PORT**.
- --out <path> / --out-dir <dir> (optional): output path or directory.

### Default output directory
- $ECLIA_ARTIFACT_DIR
- --out-dir if provided

### Examples
``` bash
/Users/cain/ECLIA/skills/Stable-Diffusion/sd-t2i.sh --host http://127.0.0.1:7860 --template /Users/cain/ECLIA/skills/Stable-Diffusion/templates/ntrMIXIllustriousXL_v40.json --prompt "portrait, cinematic"
```

### Information
Launch Local Stable Diffusion Webui A1111 Command: undefined
Launch Local Stable Diffusion Webui Forge Command: undefined
Local Server url: undefined
Remote Server url: undefined
User Prefered Model/Template: undefined
User Prefered Server: Local/Remote