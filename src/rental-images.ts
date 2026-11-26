import type { ImageRef, RentalImage } from "./api";
export const IMAGE_SOURCE = { base: "基础镜像", mine: "我的镜像", shared: "共享给我" } as const;
export function sameImage(a: ImageRef | null, b: ImageRef | null) { return !!a && !!b && a.uuid === b.uuid && a.source === b.source; }
export function imageProblem(image: RentalImage, maxCuda?: number | null): string | null {
  if (image.status !== "finished") return image.status === "saving" ? "保存中" : image.status === "failed" ? "保存失败" : "尚未就绪";
  return image.cuda != null && maxCuda != null && image.cuda > maxCuda ? "CUDA 高于主机支持版本" : null;
}
export function filterImages(images: RentalImage[], search: string, source: "all" | "mine" | "shared", framework: string, cuda: string) {
  const words = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return images.filter((i) => (source === "all" || i.source === source) && (!framework || i.framework === framework)
    && (!cuda || (cuda === "unknown" ? i.cuda == null : i.cuda === Number(cuda)))
    && words.every((w) => `${i.name} ${i.framework} ${i.owner ?? ""}`.toLocaleLowerCase().includes(w)));
}
