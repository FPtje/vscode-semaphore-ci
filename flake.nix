{
  description = "A VS Code extension for interacting with Semaphore CI.";
  inputs.nixpkgs.url = "nixpkgs/nixpkgs-unstable";

  outputs = { self, nixpkgs }:
    let
      supportedSystems = [ "x86_64-linux" ];

      # Helper function to generate an attrset '{ x86_64-linux = f "x86_64-linux"; ... }'.
      forAllSystems = nixpkgs.lib.genAttrs supportedSystems;
    in
    {
      devShell = forAllSystems (system: with nixpkgs.legacyPackages.${system}; mkShell {
        buildInputs = [nodejs];
      });
    };
}
