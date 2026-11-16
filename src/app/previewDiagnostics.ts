import type { FinalPreviewPass } from "../engine/finalPreview";
import type { RenderTiming } from "../engine/engine";
import type { PreviewProfileRow } from "../engine/previewProfile";

/** Visible measurements are tied to the image that was actually presented, never a queued obsolete frame. */
export class PreviewDiagnostics {
  readonly root = document.createElement("details");
  readonly status = document.createElement("div");
  private text = document.createElement("pre");
  private profile = document.createElement("pre");
  constructor(requestProfile: () => void) {
    this.root.id = "preview-diagnostics";
    this.status.id = "preview-status";
    this.status.setAttribute("aria-live", "polite");
    const summary = document.createElement("summary");
    summary.textContent = "Preview diagnostics";
    const button = document.createElement("button");
    button.textContent = "Measure the preview steps";
    button.onclick = requestProfile;
    this.root.append(summary, this.status, this.text, button, this.profile);
    document.body.append(this.root);
  }
  show(
    pass: FinalPreviewPass,
    timings: RenderTiming[],
    wallMs: number,
    firstMs: number,
    processorMs: number,
    presentationMs: number,
    denoiseGpuMs=0,
  ): void {
    this.status.textContent = `${pass.width}×${pass.height} · ${pass.approximation ? "fast whole picture / deep DOF" : `${pass.sampleOffset + 1}/${pass.targetSamples} lens/AA samples`} · ${wallMs.toFixed(0)} ms`;
    this.status.dataset.sequence = String(pass.sequence);
    this.status.dataset.sample = String(
      pass.approximation ? 0 : pass.sampleOffset + 1,
    );
    this.status.dataset.firstMs = String(firstMs);
    this.status.dataset.denoiseGpuMs=String(denoiseGpuMs);
    const total = (key: "gpuMs" | "readbackMs" | "accumulationMs") =>
      timings.reduce((n, t) => n + t[key], 0);
    this.text.textContent = `First visible picture: ${firstMs.toFixed(0)} ms\nGPU shader (${timings[0]?.gpuClock ?? "n/a"}): ${total("gpuMs").toFixed(2)} ms\nDenoise GPU: ${denoiseGpuMs.toFixed(2)} ms\nReadback: ${total("readbackMs").toFixed(2)} ms\nCPU pixel copying: ${total("accumulationMs").toFixed(2)} ms\nDOF / accumulation / filter transfer: ${processorMs.toFixed(2)} ms\nPresentation: ${presentationMs.toFixed(2)} ms\nEffective march/shadow/AO/cavity: ${pass.quality.max_steps}/${pass.quality.shadow_steps}/${pass.details.ao.samples}/${pass.details.cavity.samples}\nThe preview budget does not affect the saved final quality.`;
  }
  profiling(): void {
    this.profile.textContent = "Measuring controlled GPU passes … input cancels.";
  }
  showProfile(rows: PreviewProfileRow[], width: number, height: number): void {
    this.profile.textContent =
      `${width}×${height}, median of 3 warm passes.\nMeasured marginal cost in the shared shader; negative differences show measurement variation.\n` +
      rows
        .map(
          (r) =>
            `${r.name}: ${r.marginalMs.toFixed(3)} ms (kumulativt ${r.cumulativeMs.toFixed(3)}, ${r.clock})`,
        )
        .join("\n");
  }
  cancelled(): void {
    if (this.profile.textContent?.startsWith("Measuring"))
      this.profile.textContent = "The measurement was cancelled by input.";
  }
  invalidate(): void {
    this.status.textContent = "Preparing a new whole picture …";
    delete this.status.dataset.sequence;
    delete this.status.dataset.sample;
    delete this.status.dataset.firstMs;
    delete this.status.dataset.denoiseGpuMs;
    this.cancelled();
  }
}
