---
library_name: transformers
license: gemma
pipeline_tag: text-generation
tags:
- conversational
- mlx
extra_gated_heading: Access Gemma on Hugging Face
extra_gated_prompt: To access Gemma on Hugging Face, you’re required to review and
  agree to Google’s usage license. To do this, please ensure you’re logged in to Hugging
  Face and click below. Requests are processed immediately.
extra_gated_button_content: Acknowledge license
---

# mlx-community/gemma-2-2b-it-4bit

The Model [mlx-community/gemma-2-2b-it-4bit](https://huggingface.co/mlx-community/gemma-2-2b-it-4bit) was converted to MLX format from [google/gemma-2-2b-it](https://huggingface.co/google/gemma-2-2b-it) using mlx-lm version **0.16.1**.

## Use with mlx

```bash
pip install mlx-lm
```

```python
from mlx_lm import load, generate

model, tokenizer = load("mlx-community/gemma-2-2b-it-4bit")
response = generate(model, tokenizer, prompt="hello", verbose=True)
```
