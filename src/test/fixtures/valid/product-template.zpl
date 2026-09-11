^FX Data-merge template. Run "Label: Merge Data Into Labels" with samples/products.csv.
^XA
^PW812
^LL406
^CF0,44
^FO20,20^FD{{name}}^FS
^CF0,24
^FO20,80^FDSKU: {{sku|upper}}^FS
^FO20,112^FDPrice: {{price}}^FS
^FO20,144^FDLocation: {{aisle}}-{{bin|pad:3}}^FS
^FO20,185^BY2,3,80
^BCN,80,Y,N,N
^FD{{sku|upper}}^FS
^FO560,180^BQN,2,5
^FDQA,{{url}}^FS
^XZ
