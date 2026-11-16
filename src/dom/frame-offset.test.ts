import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { frameContentOffset } from "./frame-offset";

/**
 * A stand-in for an `<iframe>` hosting `child`. A real one would make happy-dom try to load
 * a page once connected (and log a NotSupportedError, since iframe loading is disabled);
 * the function only reads `contentWindow`, the box and the computed style, so a connected
 * `<div>` with those set behaves the same.
 */
function fakeHost(child: object, left: number, top: number, style: Partial<CSSStyleDeclaration>) {
  const host = document.createElement("div") as unknown as HTMLIFrameElement;
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

describe("frameContentOffset: default search", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("finds an iframe inside an open shadow root", () => {
    const child = {} as Window;
    const component = document.createElement("div");
    document.body.append(component);
    const host = fakeHost(child, 10, 20, {});
    component.attachShadow({ mode: "open" }).append(host);
    // Make the stand-in match the frame selector the search uses.
    vi.spyOn(component.shadowRoot!, "querySelectorAll").mockImplementation(((selector: string) =>
      selector === "iframe, frame" ? [host] : []) as never);

    expect(frameContentOffset(child)).toEqual({ x: 12, y: 23 });
  });
});
