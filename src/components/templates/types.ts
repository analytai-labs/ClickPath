export type TemplateType = "bio" | "pharma_product";

export type PharmaProductData = {
  productName: string;
  composition: string;
  productOverview: string;
  marketed: { name: string; address: string };
  manufactured: { name: string; address: string };
  productImages: string[];
  documents: { imageUrl: string; name: string }[];
  contact: { name: string; whatsapp: string; email: string };
};

export const EMPTY_PHARMA_PRODUCT_DATA: PharmaProductData = {
  productName: "",
  composition: "",
  productOverview: "",
  marketed: { name: "", address: "" },
  manufactured: { name: "", address: "" },
  productImages: [],
  documents: [],
  contact: { name: "", whatsapp: "", email: "" },
};
