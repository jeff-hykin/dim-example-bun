{
    description = "dim-example-bun: a dimOS Desktop app with a Bun server (zenoh-bun) and a dimos-react page, no build (`nix build .#dimosApp` -> bin/dimos-app-server)";
    inputs = {
        nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";
        # the server's one dependency, at the tag package.json names (keep the two in step)
        zenoh-bun = { url = "github:jeff-hykin/zenoh-bun/v0.1.0"; flake = false; };
    };
    outputs = { self, nixpkgs, zenoh-bun }:
        let
            systems = [ "aarch64-darwin" "x86_64-darwin" "x86_64-linux" "aarch64-linux" ];
            forAll = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
            # zenoh-bun loads zenoh-deno's release binaries; the 1.6.2 build (what Desktop's zenoh-gateway runs), by the
            # sha256 zenoh-bun itself checks (its lib/native/binary_checksums.ts), so the server runs offline
            native = {
                aarch64-darwin = { file = "libzenoh_deno_1_6_2-darwin-aarch64.dylib"; sha256 = "0dbe9962e4a3278f33338a6ac314db6cd909dd3f2762853d76a594ccdce351a2"; };
                x86_64-darwin = { file = "libzenoh_deno_1_6_2-darwin-x86_64.dylib"; sha256 = "4ddbe739e96abdb114dd22b9a8c3932e9d37faae039fff0be779972f2cb05e3b"; };
                x86_64-linux = { file = "libzenoh_deno_1_6_2-linux-x86_64.so"; sha256 = "f81c1ff25bb2ed2740812f00e84ba51b21987707a1e3d78d8e6dbd96b0c17ff2"; };
                aarch64-linux = { file = "libzenoh_deno_1_6_2-linux-aarch64.so"; sha256 = "1be7c4af2b4801155a9c16947f0d8b0103e72a9a27556b6bf1407a6aecf15b52"; };
            };
        in {
            packages = forAll (pkgs:
                let
                    lib = native.${pkgs.stdenv.hostPlatform.system};
                    nativeLibrary = pkgs.fetchurl {
                        url = "https://github.com/jeff-hykin/zenoh-deno/releases/download/v0.1.1/${lib.file}";
                        inherit (lib) sha256;
                    };
                    files = paths: pkgs.lib.fileset.toSource { root = ./.; fileset = pkgs.lib.fileset.unions paths; };
                in rec {
                    # the server, the page (served as is) and node_modules/zenoh-bun with its native library bundled
                    app = pkgs.runCommand "dim-example-bun" { } ''
                        cp -R ${files [ ./server ./frontend ./package.json ]} $out
                        chmod -R u+w $out
                        mkdir -p $out/node_modules
                        cp -R ${zenoh-bun} $out/node_modules/zenoh-bun
                        chmod -R u+w $out/node_modules/zenoh-bun
                        mkdir -p $out/node_modules/zenoh-bun/lib/native/prebuilt
                        cp ${nativeLibrary} $out/node_modules/zenoh-bun/lib/native/prebuilt/${lib.file}
                    '';
                    # Desktop runs `nix build .#dimosApp`; a bin/dimos-app-server is started with DIMOS_APP and proxied at /apps/<name>/
                    dimosApp = pkgs.writeShellScriptBin "dimos-app-server" ''
                        export BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
                        exec ${pkgs.bun}/bin/bun run --no-install ${app}/server/main.ts --frontend ${app}/frontend "$@"
                    '';
                    default = dimosApp;
                });
        };
}
