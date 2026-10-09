const key='weekback-v1';
export const seed=()=>({tasks:[{id:'math',title:'Problem Set 4: Eigenvalues & Symmetric Matrices',course:'MATH 54',minutes:150,day:0,time:'14:00',status:'planned'},{id:'code',title:'Machine Problem 2: Gaussian Elimination',course:'CS 150',minutes:120,day:1,time:'11:00',status:'planned'},{id:'history',title:'Source Analysis Paper',course:'KAS 1',minutes:90,day:2,time:'16:00',status:'planned'}],previous:null});
export function load(){try{const x=JSON.parse(localStorage.getItem(key));return x&&Array.isArray(x.tasks)?x:seed();}catch{return seed();}}
export function save(data){localStorage.setItem(key,JSON.stringify(data));}
