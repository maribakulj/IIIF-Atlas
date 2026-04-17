declare module "mirador" {
  interface MiradorViewerHandle {
    unmount?: () => void;
  }
  interface MiradorNamespace {
    viewer: (config: unknown) => MiradorViewerHandle;
  }
  const mirador: MiradorNamespace;
  export default mirador;
}
