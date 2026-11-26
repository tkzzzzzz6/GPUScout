import { createContext, useContext, useState, type ReactNode } from "react";
import type { ImageRef, RentalPlan } from "./api";
const Selection = createContext<{ image: ImageRef | null; plan:RentalPlan|null; apply:(plan:RentalPlan)=>void; select: (image: ImageRef | null) => void }>({ image:null, plan:null, apply:()=>{}, select:()=>{} });
export function RentalSelectionProvider({ children }: { children: ReactNode }) {
  const [plan,setPlan]=useState<RentalPlan|null>(null);
  const [image, setImage] = useState<ImageRef | null>(null);
  return <Selection.Provider value={{ image, plan, select:(i)=>{setImage(i);setPlan(null);}, apply:(p)=>{setPlan(p);setImage({uuid:p.image_uuid,source:p.image_source});} }}>{children}</Selection.Provider>;
}
export const useRentalSelection = () => useContext(Selection);
