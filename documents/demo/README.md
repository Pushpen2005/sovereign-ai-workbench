# Synthetic Demonstration Data

> [!NOTE]
> All files in this directory are **SYNTHETIC DEMONSTRATION DATA** created exclusively for evaluating and demonstrating the **SovereignAI** industrial workbench.
>
> They do **NOT** contain real-world, confidential, proprietary, or classified industrial records from MRPL or any refinery facility.

## Available Demo Files

1. **`Pump03_Inspection.pdf`**
   - Synthetic daily equipment inspection log for a centrifugal cooling pump.
   - Highlights an observed bearing temperature of **92°C** and vibration anomalies.
   - Used for: RAG Q&A, Inspection Agent finding extraction, and Approval Note generation.

2. **`Maintenance_SOP.pdf`**
   - Standard Operating Procedure (`SOP-MAINT-001`) for rotating equipment.
   - Defines normal operating bearing temperature limit as **80°C**.
   - Used for: Grounded SOP retrieval, numerical technical analysis, and risk assessment.

3. **`Safety_SOP.pdf`**
   - Standard Operating Procedure (`SOP-SAFETY-004`) covering thermal hazards and PPE.
   - Used for: Multi-document RAG and cross-document citation validation.

4. **`Pump03_Vibration_Gauge.png`**
   - Synthetic vibration sensor display graphic showing an alarm reading of **6.8 mm/s**.
   - Used for: Local Multimodal Vision demonstration with `moondream:latest`.
