# Stable-Diffusion

Generates images by calling a Stable Diffusion WebUI Forge server via its REST API using a local script.
Use sd-t2i.sh for Mac or sd-t2i.ps1 for Windows.

Usage:
- --prompt "<text>" (required): the user prompt for this run.
- --template /path/to/<model.json> (required): model-specific defaults (steps/cfg/sampler/size/model/hires params), saved under /Skills/Stable-Diffusion/templates. **It needs an absolute path or relative path.**
- --upscale (optional): enable Hires Fix (disabled by default).
- --host <url:port> (optional): Forge base URL (default http://127.0.0.1:7860), **INCLUDE THE PORT**.
- --out <path> / --out-dir <dir> (optional): output path or directory.

Default output directory is:
- --out-dir if provided
- $ECLIA_ARTIFACT_DIR if set

Examples:
``` bash
$ECLIA_SKILLS_DIR/Stable-Diffusion/sd-t2i.sh --host http://127.0.0.1:7860 --template $ECLIA_SKILLS_DIR/Stable-Diffusion/templates/ntrMIXIllustriousXL_v40.json --prompt "portrait, cinematic"
```