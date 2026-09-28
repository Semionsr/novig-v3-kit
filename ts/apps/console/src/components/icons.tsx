/* Simple line icons drawn to sit next to Monument at 18px, like novig.com's nav. */
import type { SVGProps } from "react";

const base = (p: SVGProps<SVGSVGElement>) => ({ width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, ...p });

export const IconMarkets = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M3 17l5-5 4 4 8-9" /><path d="M15 7h5v5" /></svg>);
export const IconKey = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M17 6l3 3M14 9l2 2" /></svg>);
export const IconPulse = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M3 12h4l3-8 4 16 3-8h4" /></svg>);
export const IconGauge = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M4 18a8 8 0 1 1 16 0" /><path d="M12 18l4-6" /></svg>);
export const IconBot = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><rect x="4" y="7" width="16" height="12" rx="3" /><path d="M12 3v4M9 12h.01M15 12h.01M9 16h6" /></svg>);
export const IconRocket = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M5 19l3-1 8-8a4 4 0 0 0-5-5l-8 8-1 3 3 3z" /><path d="M13 6l5 5M6 14l4 4" /></svg>);
export const IconSearch = (p: SVGProps<SVGSVGElement>) => (<svg {...base({ width: 18, height: 18, ...p })}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>);
export const IconInfo = (p: SVGProps<SVGSVGElement>) => (<svg {...base({ width: 18, height: 18, ...p })}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>);
export const IconCheck = (p: SVGProps<SVGSVGElement>) => (<svg {...base({ width: 16, height: 16, strokeWidth: 2.4, ...p })}><path d="M5 12l5 5 9-10" /></svg>);
export const IconX = (p: SVGProps<SVGSVGElement>) => (<svg {...base({ width: 16, height: 16, strokeWidth: 2.4, ...p })}><path d="M6 6l12 12M18 6L6 18" /></svg>);
export const IconArrow = (p: SVGProps<SVGSVGElement>) => (<svg width="12" height="12" viewBox="0 0 12 12" {...p}><path fillRule="evenodd" clipRule="evenodd" d="M7.08585 6.0001L2.54297 1.45718L3.95718 0.0429688L9.9143 6.0001L3.95718 11.9572L2.54297 10.5429L7.08585 6.0001Z" fill="currentColor" /></svg>);
export const IconChevron = ({ dir = "right", ...p }: SVGProps<SVGSVGElement> & { dir?: "left" | "right" }) => (<svg {...base({ width: 18, height: 18, strokeWidth: 2.2, ...p })}>{dir === "right" ? <path d="M9 5l7 7-7 7" /> : <path d="M15 5l-7 7 7 7" />}</svg>);
export const IconCode = (p: SVGProps<SVGSVGElement>) => (<svg {...base(p)}><path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" /></svg>);
