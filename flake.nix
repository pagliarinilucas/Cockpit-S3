{
  description = "cockpit-s3 dev shell";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
    in {
      devShells.${system}.default = pkgs.mkShell {
        packages = with pkgs; [ bun nodejs_22 pnpm ];

        # Addons nativos N-API pré-compilados (ex.: sodium-native) linkam
        # libstdc++.so.6, que o NixOS não expõe no loader por padrão. Sem isso
        # `bun test` falha com ADDON_NOT_FOUND / "libstdc++.so.6: cannot open".
        LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath [ pkgs.stdenv.cc.cc.lib ];
      };
    };
}
