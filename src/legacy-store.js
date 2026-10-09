// Legacy v1 store kept only so the pre-integration UI keeps working. Person 4: migrate app.js to store.js (v2) and delete this file.
const key='weekback-v1';
export const seed=()=>({tasks:[
  {id:'lecture',title:'Pointers & Dynamic Memory Management',course:'CS 21 · COMPUTER PROGRAMMING',minutes:0,sessionMinutes:75,day:0,time:'09:00',status:'done',location:'MH 318 · Melchor Hall'},
  {id:'code',title:'Machine Problem 2: Gaussian Elimination',course:'CS 150 · NUMERICAL METHODS',minutes:0,sessionMinutes:90,day:0,time:'11:00',status:'done',location:'Engineering Library II'},
  {id:'math',title:'Problem Set 4: Eigenvalues & Symmetric Matrices',course:'MATH 54 · ADVANCED CALCULUS',minutes:150,sessionMinutes:90,day:0,time:'14:00',status:'planned',dueDay:3,location:'MH 318 · CS Library',step:'Questions 4–6: Characteristic polynomials & orthogonal diagonalization proofs.',reference:'Your problem set and lecture notes'},
  {id:'reading',title:'Primary Reading: Teodoro Agoncillo (Ch. 5 & 6)',course:'KAS 1 · KASAYSAYAN NG PILIPINAS',minutes:90,sessionMinutes:90,day:0,time:'16:30',status:'planned',dueDay:4},
  {id:'org',title:'Student Organization Executive Meeting',course:'STUDENT ORGANIZATION',minutes:60,sessionMinutes:60,day:0,time:'19:00',status:'planned',kind:'fixed',location:'Student Center'},
  {id:'code-next',title:'Machine Problem 3: Draft & Test',course:'CS 150',minutes:210,sessionMinutes:90,day:1,time:'11:00',status:'planned',dueDay:5},
  {id:'history',title:'Source Analysis Paper',course:'KAS 1',minutes:180,sessionMinutes:90,day:2,time:'16:00',status:'planned',dueDay:6}
],previous:null});
export function load(){try{const x=JSON.parse(localStorage.getItem(key));return x&&Array.isArray(x.tasks)?x:seed();}catch{return seed();}}
export function save(data){localStorage.setItem(key,JSON.stringify(data));}
