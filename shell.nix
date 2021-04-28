{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  buildInputs = [
    pkgs.nodejs pkgs.moreutils pkgs.jq pkgs.gnumake

    # keep this line if you use bash
    pkgs.bashInteractive
  ];
}
