# Comprovantes perdidos — levantamento de 17/07/2026

Auditoria da coluna K da planilha (2.026 linhas verificadas, uma a uma, contra o S3):

| Situação | Quantidade |
|---|---|
| "Ver comprovante" clicável (S3, renovação automática) | 123 + 74 legados possíveis* |
| Links do Google Drive convertidos pra "Ver comprovante" (não expiram) | 1.649 |
| Sem comprovante (célula vazia) | 52 |
| **Perdidos — arquivo não existe no S3 nem no Drive** | **74** |

## Os 74 perdidos

São da era em que o comprovante era salvo **no disco local da instância** (antes da migração
pro S3) e foram apagados em algum deploy/troca de instância do Elastic Beanstalk.
Ocupam as linhas **1653–1752** da planilha (período concentrado — checar as datas dessas
linhas pra saber o intervalo exato).

**Não há como recuperar pelo sistema.** Alternativas: extrato bancário do período
(Pix/transferência tem comprovante no banco), ou pedir segunda via ao cliente se algum
desses recibos for contestado.

Linhas e arquivos (nome do arquivo era um hash, sem o nome do cliente — cruzar pela linha
da planilha, colunas B/C/M da mesma linha identificam cliente e número do recibo):

- linha 1653: 620a70c9f555f84c27d863313027b741.pdf
- linha 1665: c6a296b8f0b3a7da483e0411fd2ba1b4.pdf
- linha 1666: e8edac027f98345abb485d675845739e.pdf
- linha 1667: 108c9b9a70b38dbcac94263c8080061f.pdf
- linha 1668: 62059bf59497e8448fcb03a9de22fe23.pdf
- linha 1669: d1894b6773c0378da5b50dbeeb27f4f9.pdf
- linha 1670: 0e62fd11017e0abe4a5faf8f511caf36.pdf
- linha 1671: ee9f03cc7453430b63ea0f2640cc9e14.pdf
- linha 1672: f8a0a49398853eb88585dab879532c63.pdf
- linha 1673: 432bbd977448b8fbfde2453769447e9e.pdf
- linha 1674: 1f97a517930a6690fc3725ba8becae96.pdf
- linha 1675: 7a53da37d9d5b78e49656878ff7de3f1.pdf
- linha 1677: 33df834dcc67afa109746bfed3f3081d.pdf
- linha 1678: 0bef64a4fdd702f80c392218e41b55c7.pdf
- linha 1679: 62f9788b191048ee2950741ea10ecbbb.jpg
- linha 1680: 13a19a79762b939ae3b7aa3baa30358e.pdf
- linha 1681: 35adb86038057ac315e8d865d88ee7b2.pdf
- linha 1682: 01763aea2ba46f487ec82eb006744b1e.pdf
- linha 1683: 19614f2cc763dcf4a979e7f552cb6b1d.pdf
- linha 1684: 6d55f21c3606d3c6a1b88d778d7f8d5d.pdf
- linha 1685: dd2099c46293c3eaf7ebcfe7610cab48.pdf
- linha 1686: 61af8c72a5f5eb6d3be2cbb81d8ece1f.pdf
- linha 1687: b3955cd5b1153322725c88964a04ce36.pdf
- linha 1689: bc2d47cf1808b76519d545cb0ca3538e.pdf
- linha 1690: 68c9d0d86508a4fca84c807514f9cbe4.pdf
- linha 1691: d445f81de61c295f055686cc04d172a1.pdf
- linha 1692: 4d07ad29d328eb2462589e65fe23033f.pdf
- linha 1693: 5ef57f6b38ecc5312e44ebbe7e5c43c8.pdf
- linha 1694: 773424ee208dd34f7494c3cfae3254a9.pdf
- linha 1695: b03059da37f9c593dd86c6f16a4541d5.pdf
- linha 1696: df300bcf66d4db676798d4586809fba7.pdf
- linha 1697: dbb39f8ed9eb86161d9775b39f60abc5.pdf
- linha 1698: 1d9089456a7614a361f004188e1b9c1f.pdf
- linha 1701: 105af640a8442cc3fcd175fb2ae518d0.pdf
- linha 1702: df6354caaeddb4ca92dfceb30c01ab52.pdf
- linha 1703: 805663f7459b827c0ac9e48d43648070.pdf
- linha 1704: e5036dc3491c85f84b75d36aab35a32b.pdf
- linha 1705: 6406d461ecdf907a7b127a7d280d2f0f.pdf
- linha 1706: 80ebd948c325b96e0e93e65a2bd6a23d.pdf
- linha 1708: e394dbb83cc7c9f2d2e473250a531496.pdf
- linha 1710: 557625d17e6047ef3dd172aeacb7ac30.pdf
- linha 1711: dd93457d9fc86025ff3cd1f43204f4a9.pdf
- linha 1712: a1b260fbdeec4eef013701eaeab5416d.pdf
- linha 1713: fb22c708057a25a48c449a55ee12d9ab.pdf
- linha 1714: d53e173013b529b20eb72c227868d342.pdf
- linha 1716: c344f7f6cad6f4908df68ee776f76331.pdf
- linha 1717: 3de0f3f6c4ae2fbeed5df2630fe25556.pdf
- linha 1718: 6b373f69c5a5a560151a9b75753d5de1.pdf
- linha 1719: 2a506b0949c8bd5a6c9e0d6d84a7f860.pdf
- linha 1720: d6613e00dca88a252f0f076713811478.pdf
- linha 1721: f82f17b7e37e862918edbddbe1c14316.pdf
- linha 1722: ba01d21b75c194b5622bf24869d31cdd.pdf
- linha 1723: 9b0d83927a9289158950c3c402494593.pdf
- linha 1724: 6019f983a6105d28638938d370f09ef4.pdf
- linha 1725: fd3b02d51cd7db712be7b1ab29c93728.pdf
- linha 1726: 7a456c3fe3079836c8adb0f2497a5ff5.pdf
- linha 1727: f79c86bf0625302be243657294ade9cb.pdf
- linha 1728: 24201a4cb5047cc40ab3f84f837e3f28.pdf
- linha 1729: df8bd3323c822c24d261562273d7d07b.pdf
- linha 1730: 81f3cf8ba4df5a8f188752cf8cf9a3ac.pdf
- linha 1732: fa55f09aa5924bdef07ba07ca5e8e6af.pdf
- linha 1733: 31846f61202b321577c554ad8b3f28d4.pdf
- linha 1734: da47262f668729cebfe7f1e02415c00d.pdf
- linha 1735: 0713bc6303ac7850053ec4313a56ba7d.pdf
- linha 1736: 363c384cb0f0a197ce6c01b3bc53c628.pdf
- linha 1737: 39f03a666c48469d2430161cbeb3a688.pdf
- linha 1738: 4639c33ca59c6541452fe6bff46ace03.pdf
- linha 1739: a7aeb8da322af820a5c543ad466af604.pdf
- linha 1740: 917512eb17d65415046206004e0793ef.pdf
- linha 1741: 2940107374165bbc49d61cd76f719ad8.pdf
- linha 1743: 7fd1646467a12386d3d11b5e797c0bbb.pdf
- linha 1746: cf806eeb1c8d3e7302d5cc9a21b5517b.pdf
- linha 1749: 20fe6be290b5b8957f2b8735f377cc9d.pdf
- linha 1752: c782cb38823c8d623c84b1c5a27abd10.pdf

*Nota: os 74 caminhos `/api/comprovante/...` foram deixados como estavam na planilha
(célula com texto morto) — servem de marcador de que ali havia um comprovante.*
