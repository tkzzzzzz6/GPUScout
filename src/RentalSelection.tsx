import { createContext, useContext, useState, type ReactNode } from "react";
import type { ImageRef } from "./api";
const Selection = createContext<{ image: ImageRef | null; select: (image: ImageRef | null) => void }>({ image:null, select:()=>{} });
export function RentalSelectionProvider({ children }: { children: ReactNode }) {
  const [image, select] = useState<ImageRef | null>(null);
  return <Selection.Provider value={{ image, select }}>{children}</Selection.Provider>;
}
export const useRentalSelection = () => useContext(Selection);
