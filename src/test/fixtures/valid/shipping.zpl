^XA
^FX --- Sender block ---
^CF0,40
^FO30,30^FDFROM:^FS
^CF0,28
^FO30,80^FDAcme Shipping Co.^FS
^FO30,120^FD123 Main Street^FS
^FO30,160^FDSpringfield, IL 62701^FS

^FX --- Recipient block ---
^CF0,40
^FO30,240^FDTO:^FS
^CF0,32
^FO30,290^FDJane Doe^FS
^FO30,330^FD456 Oak Avenue^FS
^FO30,370^FDLincoln, NE 68502^FS

^FX --- Separator + Tracking barcode ---
^FO30,440^GB750,3,3^FS
^FO30,470^BY3,3,120
^BCN,120,Y,N,N
^FD1Z999AA10123456784^FS

^FX --- QR code with shipment URL ---
^FO600,700^BQN,2,6
^FDQA,https://track.example.com/1Z999AA10123456784^FS
^XZ
