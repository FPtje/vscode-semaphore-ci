{
  description = "A VS Code extension for interacting with Semaphore CI.";
  inputs.nixpkgs.url = "nixpkgs/nixpkgs-unstable";

  outputs = { self, nixpkgs }:
    let
      version = "0.0.0";

      supportedSystems = [ "x86_64-linux" ];

      # Helper function to generate an attrset '{ x86_64-linux = f "x86_64-linux"; ... }'.
      forAllSystems = nixpkgs.lib.genAttrs supportedSystems;

      # Nixpkgs instantiated for supported system types.
      nixpkgsFor = forAllSystems (
        system: import nixpkgs { inherit system; overlays = [ self.overlay ]; }
      );
    in
    {

      # A Nixpkgs overlay.
      overlay = final: prev: {

      };

      # Provide some binary packages for selected system types.
      packages = forAllSystems (system:
        {
        });

      # The default package for 'nix build'. This makes sense if the
      # flake provides only one package or there is a clear "main"
      # package.
      # defaultPackage = forAllSystems (system: self.packages.${system}.hello);

      devShell = forAllSystems (system: with nixpkgs.legacyPackages.${system}; mkShell {
        buildInputs = [nodejs];
      });
    };
}
