export const imageSettings = {
  baseURL: "https://ai.gateway.lovable.dev",
  model: "openai/gpt-image-2.5-sunburst",
};

export function editImage(apiKey: string, form: FormData) {
  const streaming = form.get("stream") !== "false";
  form.set("model", imageSettings.model);
  if (streaming) {
    form.set("stream", "true");
    if (!form.has("partial_images")) form.set("partial_images", "1");
  } else {
    form.delete("stream");
    form.delete("partial_images");
  }
  return fetch(`${imageSettings.baseURL}/v1/images/edits`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
}
