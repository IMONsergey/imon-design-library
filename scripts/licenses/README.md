# Missing npm license files

`react-remove-scroll-bar@2.3.8` declares MIT in its published package.json, but its npm archive does not include LICENSE. Its published gitHead is `b3b1287aad81def2e2ae707274b74531b61ddbaf`, which also predates the upstream license file.

The unchanged license text is preserved from the author's later explicit LICENSE addition:

https://github.com/theKashey/react-remove-scroll-bar/blob/7301c160fda44cb8cf2b9fdfde61efad35736196/LICENSE

The build uses this local copy only for this exact dependency/version. It does not fetch licenses from the network, invent copyright attribution, or grant a new license. A dependency upgrade must be reviewed again if its package still omits the license file.
