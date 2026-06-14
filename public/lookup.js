/* Offline lookups — ICAO airline codes and aircraft type codes.
   Used to resolve names from ADS-B data (which broadcasts neither). */
window.AIRLINES = {
  // North America
  AAL: 'American Airlines', UAL: 'United Airlines', DAL: 'Delta Air Lines',
  SWA: 'Southwest Airlines', JBU: 'JetBlue', ASA: 'Alaska Airlines',
  FFT: 'Frontier Airlines', NKS: 'Spirit Airlines', HAL: 'Hawaiian Airlines',
  SKW: 'SkyWest', RPA: 'Republic Airways', ENY: 'Envoy Air', JIA: 'PSA Airlines',
  EDV: 'Endeavor Air', GJS: 'GoJet', QXE: 'Horizon Air', ASH: 'Mesa Airlines',
  ACA: 'Air Canada', ROU: 'Air Canada Rouge', WJA: 'WestJet', TSC: 'Air Transat',
  JZA: 'Jazz Aviation', AMX: 'Aeroméxico', VOI: 'Volaris', VIV: 'Viva Aerobus',
  // UK & Ireland
  BAW: 'British Airways', VIR: 'Virgin Atlantic', EZY: 'easyJet', EJU: 'easyJet Europe',
  RYR: 'Ryanair', EXS: 'Jet2', TOM: 'TUI Airways', LOG: 'Loganair', EIN: 'Aer Lingus',
  // Germany / Central Europe
  DLH: 'Lufthansa', CFG: 'Condor', EWG: 'Eurowings', GEC: 'Lufthansa Cargo',
  SWR: 'SWISS', AUA: 'Austrian Airlines', BEL: 'Brussels Airlines', OCN: 'Eurowings Discover',
  // France / Benelux / South
  AFR: 'Air France', TVF: 'Transavia France', KLM: 'KLM', TRA: 'Transavia',
  IBE: 'Iberia', IBS: 'Iberia Express', VLG: 'Vueling', AEA: 'Air Europa',
  AZA: 'ITA Airways', TAP: 'TAP Air Portugal',
  // Nordics / East
  SAS: 'SAS', FIN: 'Finnair', NAX: 'Norwegian', NSZ: 'Norwegian', NOZ: 'Norwegian',
  LOT: 'LOT Polish', CSA: 'Czech Airlines', WZZ: 'Wizz Air', AEE: 'Aegean Airlines',
  ICE: 'Icelandair', WIF: 'Widerøe', BTI: 'airBaltic',
  // Middle East / Turkey
  THY: 'Turkish Airlines', PGT: 'Pegasus', UAE: 'Emirates', ETD: 'Etihad Airways',
  QTR: 'Qatar Airways', SVA: 'Saudia', GFA: 'Gulf Air', KAC: 'Kuwait Airways',
  OMA: 'Oman Air', ABY: 'Air Arabia', FDB: 'flydubai', ELY: 'El Al',
  MEA: 'Middle East Airlines', RJA: 'Royal Jordanian', MSR: 'EgyptAir',
  // Africa
  ETH: 'Ethiopian Airlines', RAM: 'Royal Air Maroc', SAA: 'South African Airways',
  KQA: 'Kenya Airways',
  // Asia-Pacific
  QFA: 'Qantas', JST: 'Jetstar', VOZ: 'Virgin Australia', ANZ: 'Air New Zealand',
  SIA: 'Singapore Airlines', SLK: 'Scoot', CPA: 'Cathay Pacific', HDA: 'Cathay Dragon',
  JAL: 'Japan Airlines', ANA: 'All Nippon Airways', KAL: 'Korean Air', AAR: 'Asiana Airlines',
  CCA: 'Air China', CES: 'China Eastern', CSN: 'China Southern', CHH: 'Hainan Airlines',
  CSC: 'Sichuan Airlines', CXA: 'Xiamen Airlines', CAL: 'China Airlines', EVA: 'EVA Air',
  THA: 'Thai Airways', MAS: 'Malaysia Airlines', AXM: 'AirAsia', GIA: 'Garuda Indonesia',
  PAL: 'Philippine Airlines', CEB: 'Cebu Pacific', VJC: 'VietJet Air', HVN: 'Vietnam Airlines',
  AIC: 'Air India', IGO: 'IndiGo', SEJ: 'SpiceJet', AKJ: 'Akasa Air',
  // Latin America
  AVA: 'Avianca', LAN: 'LATAM', TAM: 'LATAM Brasil', GLO: 'GOL', AZU: 'Azul',
  ARG: 'Aerolíneas Argentinas', CMP: 'Copa Airlines',
  // Cargo
  FDX: 'FedEx Express', UPS: 'UPS Airlines', GTI: 'Atlas Air', CLX: 'Cargolux',
  CKS: 'Kalitta Air', ABW: 'AirBridgeCargo', BOX: 'AeroLogic', BCS: 'DHL Air',
  ABX: 'ABX Air', GSS: 'Atlas Air (DHL)', CPT: 'Corporate Air',
};

window.TYPES = {
  // Airbus
  A318: 'Airbus A318', A319: 'Airbus A319', A320: 'Airbus A320', A20N: 'Airbus A320neo',
  A321: 'Airbus A321', A21N: 'Airbus A321neo', A19N: 'Airbus A319neo',
  A332: 'Airbus A330-200', A333: 'Airbus A330-300', A338: 'Airbus A330-800neo',
  A339: 'Airbus A330-900neo', A342: 'Airbus A340-200', A343: 'Airbus A340-300',
  A345: 'Airbus A340-500', A346: 'Airbus A340-600', A359: 'Airbus A350-900',
  A35K: 'Airbus A350-1000', A388: 'Airbus A380-800', BCS1: 'Airbus A220-100', BCS3: 'Airbus A220-300',
  // Boeing
  B712: 'Boeing 717', B733: 'Boeing 737-300', B734: 'Boeing 737-400', B735: 'Boeing 737-500',
  B736: 'Boeing 737-600', B737: 'Boeing 737-700', B738: 'Boeing 737-800', B739: 'Boeing 737-900',
  B37M: 'Boeing 737 MAX 7', B38M: 'Boeing 737 MAX 8', B39M: 'Boeing 737 MAX 9', B3XM: 'Boeing 737 MAX 10',
  B741: 'Boeing 747-100', B742: 'Boeing 747-200', B744: 'Boeing 747-400', B748: 'Boeing 747-8',
  B752: 'Boeing 757-200', B753: 'Boeing 757-300', B762: 'Boeing 767-200', B763: 'Boeing 767-300',
  B764: 'Boeing 767-400', B772: 'Boeing 777-200', B77L: 'Boeing 777-200LR', B773: 'Boeing 777-300',
  B77W: 'Boeing 777-300ER', B778: 'Boeing 777-8', B779: 'Boeing 777-9', B788: 'Boeing 787-8',
  B789: 'Boeing 787-9', B78X: 'Boeing 787-10',
  // Embraer / regional
  E145: 'Embraer ERJ-145', E170: 'Embraer E170', E75L: 'Embraer E175', E75S: 'Embraer E175',
  E190: 'Embraer E190', E195: 'Embraer E195', E290: 'Embraer E190-E2', E295: 'Embraer E195-E2',
  CRJ2: 'Bombardier CRJ-200', CRJ7: 'Bombardier CRJ-700', CRJ9: 'Bombardier CRJ-900', CRJX: 'Bombardier CRJ-1000',
  DH8D: 'Bombardier Q400', AT72: 'ATR 72', AT76: 'ATR 72-600', AT45: 'ATR 42', AT75: 'ATR 72-500',
  SU95: 'Sukhoi Superjet 100', MD11: 'McDonnell Douglas MD-11', MD88: 'McDonnell Douglas MD-88',
  B463: 'BAe 146', SF34: 'Saab 340',
  // GA / business / rotor
  C172: 'Cessna 172', C152: 'Cessna 152', C182: 'Cessna 182', C208: 'Cessna Caravan',
  PC12: 'Pilatus PC-12', PC24: 'Pilatus PC-24', SF50: 'Cirrus Vision Jet', DA40: 'Diamond DA40',
  DA42: 'Diamond DA42', SR22: 'Cirrus SR22', TBM9: 'Daher TBM 900', P28A: 'Piper PA-28',
  GLF6: 'Gulfstream G650', GLF5: 'Gulfstream G550', GLEX: 'Bombardier Global', CL35: 'Bombardier Challenger 350',
  C56X: 'Cessna Citation Excel', C25A: 'Cessna CitationJet', F2TH: 'Dassault Falcon 2000',
  E55P: 'Embraer Phenom 300', LJ45: 'Learjet 45', H25B: 'Hawker 800',
  EC35: 'Airbus H135', EC45: 'Airbus H145', AS50: 'Airbus AS350', R44: 'Robinson R44', B06: 'Bell 206',
  A124: 'Antonov An-124', C130: 'Lockheed C-130', C17: 'Boeing C-17',
};
