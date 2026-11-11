import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { frameContentOffset } from "./frame-offset";

function fakeHost(child: object, left: number, top: number, style: Partial<CSSStyleDeclaration>) {
  const host = document.createElement("iframe");
  Object.defineProperty(host, "contentWindow", { value: child });
  Object.defineProperty(host, "clientLeft", { value: 2 }); // border width
  Object.defineProperty(host, "clientTop", { value: 3 });
  vi.spyOn(host, "getBoundingClientRect").mockReturnValue({ left, top } as DOMRect);
  Object.assign(host.style, style);
  document.body.append(host); // computed style needs a connected element
  return host;
}

describe("frameContentOffset", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("returns the content box origin of the iframe hosting the child", () => {
    const child = {} as Window;
    const other = fakeHost({}, 0, 0, {});
    const host = fakeHost(child, 100, 50, { paddingLeft: "4px", paddingTop: "5px" });

    expect(frameContentOffset(child, [other, host])).toEqual({ x: 106, y: 58 });
  });

  it("returns null when no element here hosts the child", () => {
    expect(frameContentOffset({} as Window, [fakeHost({}, 0, 0, {})])).toBeNull();
    expect(frameContentOffset(undefined, [])).toBeNull();
  });
});
