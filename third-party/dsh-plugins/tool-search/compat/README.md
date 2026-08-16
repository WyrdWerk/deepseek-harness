# Harness compatibility fixtures

The files under `compat/` preserve the paths consumed by DSH's external-plugin compatibility harness. They are not part of the plugin package and must not be copied into or linked from a DSH source checkout; the owning DSH test imports them into its isolated scaffold.
