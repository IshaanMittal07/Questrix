import { clsx, type ClassValue } from "clsx";

/** Joins class names; falsy values are dropped. */
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}
